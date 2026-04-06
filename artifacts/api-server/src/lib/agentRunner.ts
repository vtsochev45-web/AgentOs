import { openai } from "@workspace/integrations-openai-ai-server";
import { emitJobEvent } from "./agentEventBus";
import { getAgentMemories, reflectOnInteraction } from "./reflection";

type ToolCallDef = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatMsg =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCallDef[] }
  | { role: "tool"; content: string; tool_call_id: string };
import { db } from "@workspace/db";
import {
  agentsTable,
  agentConversationsTable,
  agentConversationMessagesTable,
  agentMessagesTable,
  activityLogTable,
  appSettingsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  webSearchTool,
  vpsShellTool,
  fileReadTool,
  fileWriteTool,
  fileListTool,
  codeExecTool,
  sendEmailTool,
  delegateToAgentTool,
  sendWebhookTool,
  websiteReadFileTool,
  websiteWriteFileTool,
  websiteBuildTool,
  websiteDeployTool,
  websiteHealthCheckTool,
  composePipelineTool,
  contextSetTool,
  contextGetTool,
} from "./agentTools";
import { persistAndEmitActivity, emitAgentStatus } from "./activityEmitter";


async function setAgentStatus(agentId: number, status: string): Promise<void> {
  await db.update(agentsTable).set({ status, lastActiveAt: new Date() }).where(eq(agentsTable.id, agentId));
  emitAgentStatus({ agentId, status });
}

async function getConfiguredModel(): Promise<string> {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  return settings?.aiModel ?? "google/gemini-2.5-flash";
}

export async function runAgentChat(
  jobId: string,
  agentId: number,
  userMessage: string,
  conversationId: number | null,
): Promise<void> {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) {
    emitJobEvent(jobId, "error", "Agent not found");
    emitJobEvent(jobId, "done", null);
    return;
  }

  const toolsEnabled = (agent.toolsEnabled ?? []) as string[];

  let convId = conversationId;
  if (!convId) {
    const [conv] = await db
      .insert(agentConversationsTable)
      .values({ agentId, title: userMessage.substring(0, 80) })
      .returning();
    convId = conv!.id;
  }

  await db.insert(agentConversationMessagesTable).values({
    conversationId: convId,
    role: "user",
    content: userMessage,
  });

  const history = await db
    .select()
    .from(agentConversationMessagesTable)
    .where(eq(agentConversationMessagesTable.conversationId, convId))
    .orderBy(agentConversationMessagesTable.timestamp)
    .limit(20);

  await setAgentStatus(agentId, "thinking");
  emitJobEvent(jobId, "step", "Analysing your request...");

  void persistAndEmitActivity({
    agentId,
    agentName: agent.name,
    actionType: "chat",
    detail: `Received: "${userMessage.substring(0, 100)}"`,
    timestamp: new Date().toISOString(),
  });

  const tools = buildToolDefinitions(toolsEnabled);
  const sources: Array<{ title: string; url: string; snippet: string; favicon?: string | null }> = [];

  // Load agent memories for context injection
  const memories = await getAgentMemories(agentId);
  const memoryBlock = memories.length > 0
    ? `\n\nYour memories from past interactions:\n${memories.join("\n")}\n`
    : "";

  const messages: ChatMsg[] = [
    {
      role: "system",
      content: `You are ${agent.name}. ${agent.persona}${memoryBlock}

You have access to tools and should use them when helpful. When you search the web, synthesize the results into a comprehensive answer with citations. After your final answer, always generate exactly 3 follow-up questions relevant to the topic.

Format your response as:
1. Use tools as needed
2. Provide a clear, well-structured answer
3. End with "FOLLOW_UPS:" followed by 3 numbered questions`,
    },
    ...history.slice(0, -1).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: userMessage },
  ];

  let finalAnswer = "";
  const model = await getConfiguredModel();

  try {
    let continueLoop = true;
    let iterations = 0;

    while (continueLoop && iterations < 5) {
      iterations++;

      const completion = await openai.chat.completions.create({
        model,
        max_completion_tokens: 8192,
        messages: messages as Parameters<typeof openai.chat.completions.create>[0]["messages"],
        ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
        stream: false,
      });

      const choice = completion.choices[0];
      if (!choice) break;

      const msg = choice.message;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push({ role: "assistant" as const, content: msg.content ?? "", tool_calls: msg.tool_calls } as ChatMsg);

        for (const toolCall of msg.tool_calls) {
          const tc = toolCall as { id: string; type: "function"; function: { name: string; arguments: string } };
          const fnName = tc.function.name;
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}

          emitJobEvent(jobId, "step", getToolStepMessage(fnName, args));
          await setAgentStatus(agentId, getToolStatus(fnName));

          let toolResult = "";

          try {
            if (fnName === "web_search") {
              const result = await webSearchTool(String(args.query ?? ""), agentId, agent.name);
              toolResult = result.output;
              if (result.sources) {
                sources.push(...result.sources);
                for (const src of result.sources) {
                  emitJobEvent(jobId, "source", src);
                }
              }
            } else if (fnName === "vps_shell") {
              const result = await vpsShellTool(String(args.command ?? ""), agentId, agent.name);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "file_read") {
              const result = await fileReadTool(agentId, agent.name, String(args.path ?? ""));
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "file_write") {
              const result = await fileWriteTool(agentId, agent.name, String(args.path ?? ""), String(args.content ?? ""));
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "file_list") {
              const result = await fileListTool(agentId, agent.name, String(args.dir ?? "/"));
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "code_exec") {
              const result = await codeExecTool(agentId, agent.name, String(args.code ?? ""), String(args.language ?? "node") as "node" | "python");
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "send_email") {
              const result = await sendEmailTool(agentId, agent.name, String(args.to ?? ""), String(args.subject ?? ""), String(args.body ?? ""));
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "delegate_to_agent") {
              const result = await delegateToAgentTool(agentId, agent.name, String(args.to_agent ?? ""), String(args.task ?? ""));
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "send_webhook") {
              const payload = (args.payload as Record<string, unknown>) ?? { message: args.message ?? "Agent notification" };
              const result = await sendWebhookTool(agentId, agent.name, payload);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "website_read") {
              const result = await websiteReadFileTool(agentId, agent.name, String(args.path ?? ""));
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "website_write") {
              const result = await websiteWriteFileTool(agentId, agent.name, String(args.path ?? ""), String(args.content ?? ""));
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "website_build") {
              const result = await websiteBuildTool(agentId, agent.name);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "website_deploy") {
              const result = await websiteDeployTool(agentId, agent.name);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "website_health") {
              const result = await websiteHealthCheckTool(agentId, agent.name);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "compose_pipeline") {
              const steps = (args.steps as Array<{ agent: string; task: string }>) ?? [];
              const result = await composePipelineTool(agentId, agent.name, steps);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "context_set") {
              const result = await contextSetTool(agentId, agent.name, String(args.namespace ?? ""), String(args.key ?? ""), args.value);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "context_get") {
              const result = await contextGetTool(agentId, agent.name, String(args.namespace ?? ""), String(args.key ?? ""));
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            }
          } catch (err) {
            toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }

          messages.push({
            role: "tool" as const,
            content: toolResult,
            tool_call_id: tc.id,
          });
        }
      } else {
        finalAnswer = msg.content ?? "";
        continueLoop = false;
      }
    }

    await setAgentStatus(agentId, "writing");
    emitJobEvent(jobId, "step", "Composing answer...");

    const followupMatch = finalAnswer.match(/FOLLOW_UPS:([\s\S]+)$/);
    let answerBody = finalAnswer;
    const followups: string[] = [];

    if (followupMatch) {
      answerBody = finalAnswer.replace(/FOLLOW_UPS:[\s\S]+$/, "").trim();
      const followupText = followupMatch[1] ?? "";
      const lines = followupText.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        const q = line.replace(/^\d+[\.\)]\s*/, "").trim();
        if (q) followups.push(q);
      }
    }

    const chunks = answerBody.split(/(?<=\. )|(?<=\n)/);
    for (const chunk of chunks) {
      if (chunk) {
        emitJobEvent(jobId, "content", chunk);
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    await db.insert(agentConversationMessagesTable).values({
      conversationId: convId!,
      role: "assistant",
      content: answerBody,
      sourcesJson: sources.length > 0 ? sources : null,
    });

    if (followups.length > 0) {
      emitJobEvent(jobId, "followups", followups.slice(0, 3));
    }

    emitJobEvent(jobId, "conversationId", convId);
    emitJobEvent(jobId, "done", null);

    // Reflection — extract memories async
    reflectOnInteraction(agentId, agent.name, userMessage, answerBody, jobId).catch(() => {});
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    emitJobEvent(jobId, "error", errMsg);
    emitJobEvent(jobId, "done", null);
  } finally {
    await setAgentStatus(agentId, "idle");
  }
}

function getToolStepMessage(fnName: string, args: Record<string, unknown>): string {
  switch (fnName) {
    case "web_search": return `Searching web for "${args.query}"...`;
    case "vps_shell": return `Running command: ${args.command}`;
    case "file_read": return `Reading file: ${args.path}`;
    case "file_write": return `Writing file: ${args.path}`;
    case "file_list": return `Listing files in: ${args.dir ?? "/"}`;
    case "code_exec": return `Executing ${args.language ?? "node"} code...`;
    case "send_email": return `Sending email to ${args.to}...`;
    case "website_read": return `Reading website file: ${args.path}`;
    case "website_write": return `Writing website file: ${args.path}`;
    case "website_build": return `Running website build...`;
    case "website_deploy": return `Deploying website...`;
    case "website_health": return `Checking site health...`;
    default: return `Using tool: ${fnName}`;
  }
}

function getToolStatus(fnName: string): string {
  if (fnName === "web_search") return "searching";
  if (fnName === "vps_shell" || fnName === "code_exec") return "executing";
  if (fnName.startsWith("file_")) return "writing";
  if (fnName.startsWith("website_")) return "executing";
  return "thinking";
}

function buildToolDefinitions(toolsEnabled: string[]) {
  const all = [
    {
      type: "function" as const,
      function: {
        name: "web_search",
        description: "Search the web for information. Returns structured results with titles, URLs, and snippets.",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "Search query" } },
          required: ["query"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "vps_shell",
        description: "Run a shell command on the VPS and return the output.",
        parameters: {
          type: "object",
          properties: { command: { type: "string", description: "Shell command to execute" } },
          required: ["command"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "file_read",
        description: "Read a file from the agent's sandboxed workspace.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "Relative file path" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "file_write",
        description: "Write content to a file in the agent's sandboxed workspace.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative file path" },
            content: { type: "string", description: "File content" },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "file_list",
        description: "List files in a directory in the agent's sandboxed workspace.",
        parameters: {
          type: "object",
          properties: { dir: { type: "string", description: "Directory path (default: /)" } },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "code_exec",
        description: "Execute a code snippet and return the output.",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "Code to execute" },
            language: { type: "string", enum: ["node", "python"], description: "Language" },
          },
          required: ["code"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "send_email",
        description: "Send an email via configured SMTP.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Email body text" },
          },
          required: ["to", "subject", "body"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "delegate_to_agent",
        description: "Delegate a subtask to another agent by name. The target agent will process it autonomously and store its response. Use this to coordinate multi-agent workflows.",
        parameters: {
          type: "object",
          properties: {
            to_agent: { type: "string", description: "Exact name of the target agent to delegate to" },
            task: { type: "string", description: "The task or question to send to the target agent" },
          },
          required: ["to_agent", "task"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "send_webhook",
        description: "Send a webhook notification to the configured webhook URL with a custom payload.",
        parameters: {
          type: "object",
          properties: {
            payload: {
              type: "object",
              description: "JSON object payload to send to the webhook URL",
            },
          },
          required: ["payload"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "website_read",
        description: "Read a file from the website directory on the VPS via SFTP.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "Full path to the file on the VPS" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "website_write",
        description: "Write/overwrite a file in the website directory on the VPS via SFTP.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Full path to the file on the VPS" },
            content: { type: "string", description: "New file content" },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "website_build",
        description: "Run the configured build command in the website directory on the VPS.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "website_deploy",
        description: "Run the configured deploy command (or build + git push) for the website on the VPS.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "website_health",
        description: "Perform an HTTP health check on the website URL and return status code and latency.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "compose_pipeline",
        description: "Run a sequence of agents as a pipeline. Each step's output feeds the next step via {previous_result}. Max 5 steps.",
        parameters: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  agent: { type: "string", description: "Agent name to delegate to" },
                  task: { type: "string", description: "Task description. Use {previous_result} to reference the previous step's output." },
                },
                required: ["agent", "task"],
              },
              description: "Ordered list of pipeline steps",
            },
          },
          required: ["steps"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "context_set",
        description: "Store a key-value pair in a shared namespace visible to all agents. Use for sharing research, decisions, or status between agents.",
        parameters: {
          type: "object",
          properties: {
            namespace: { type: "string", description: "Namespace (e.g., 'project-alpha', 'research')" },
            key: { type: "string", description: "Key name" },
            value: { description: "Value to store (any JSON)" },
          },
          required: ["namespace", "key", "value"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "context_get",
        description: "Retrieve a value from a shared namespace.",
        parameters: {
          type: "object",
          properties: {
            namespace: { type: "string", description: "Namespace" },
            key: { type: "string", description: "Key name" },
          },
          required: ["namespace", "key"],
        },
      },
    },
  ];

  const toolMap: Record<string, typeof all[0]> = {
    web_search: all[0]!,
    vps_shell: all[1]!,
    file_read: all[2]!,
    file_write: all[3]!,
    file_list: all[4]!,
    code_exec: all[5]!,
    send_email: all[6]!,
    delegate_to_agent: all[7]!,
    send_webhook: all[8]!,
    website_read: all[9]!,
    website_write: all[10]!,
    website_build: all[11]!,
    website_deploy: all[12]!,
    website_health: all[13]!,
    compose_pipeline: all[14]!,
    context_set: all[15]!,
    context_get: all[16]!,
  };

  if (toolsEnabled.includes("all") || toolsEnabled.length === 0) return all;
  return toolsEnabled.map((t) => toolMap[t]).filter(Boolean) as typeof all;
}

export async function runAgentChatInternal(
  agentId: number,
  userMessage: string,
  conversationId: number | null,
  delegationMessageId: number | null
): Promise<void> {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) return;

  const toolsEnabled = (agent.toolsEnabled ?? []) as string[];

  let convId = conversationId;
  if (!convId) {
    const [conv] = await db
      .insert(agentConversationsTable)
      .values({ agentId, title: userMessage.substring(0, 80) })
      .returning();
    convId = conv!.id;
  }

  await db.insert(agentConversationMessagesTable).values({
    conversationId: convId,
    role: "user",
    content: userMessage,
  });

  const history = await db
    .select()
    .from(agentConversationMessagesTable)
    .where(eq(agentConversationMessagesTable.conversationId, convId))
    .orderBy(agentConversationMessagesTable.timestamp)
    .limit(20);

  await setAgentStatus(agentId, "thinking");

  const tools = buildToolDefinitions(toolsEnabled);
  const sources: Array<{ title: string; url: string; snippet: string; favicon?: string | null }> = [];

  const messages: ChatMsg[] = [
    {
      role: "system",
      content: `You are ${agent.name}. ${agent.persona}

You have access to tools and should use them when helpful.

Provide a clear, well-structured answer. End your response naturally.`,
    },
    ...history.slice(0, -1).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: userMessage },
  ];

  let finalAnswer = "";
  const model = await getConfiguredModel();

  try {
    let continueLoop = true;
    let iterations = 0;

    while (continueLoop && iterations < 5) {
      iterations++;

      const completion = await openai.chat.completions.create({
        model,
        max_completion_tokens: 4096,
        messages: messages as Parameters<typeof openai.chat.completions.create>[0]["messages"],
        ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
        stream: false,
      });

      const choice = completion.choices[0];
      if (!choice) break;

      const msg = choice.message;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push({ role: "assistant" as const, content: msg.content ?? "", tool_calls: msg.tool_calls } as ChatMsg);

        for (const toolCall of msg.tool_calls) {
          const tc = toolCall as { id: string; type: "function"; function: { name: string; arguments: string } };
          const fnName = tc.function.name;
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}

          await setAgentStatus(agentId, getToolStatus(fnName));
          let toolResult = "";

          try {
            if (fnName === "web_search") {
              const result = await webSearchTool(String(args.query ?? ""), agentId, agent.name);
              toolResult = result.output;
              if (result.sources) sources.push(...result.sources);
            } else if (fnName === "vps_shell") {
              const result = await vpsShellTool(String(args.command ?? ""), agentId, agent.name);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "file_read") {
              const result = await fileReadTool(agentId, agent.name, String(args.path ?? ""));
              toolResult = result.output;
            } else if (fnName === "file_write") {
              const result = await fileWriteTool(agentId, agent.name, String(args.path ?? ""), String(args.content ?? ""));
              toolResult = result.output;
            } else if (fnName === "file_list") {
              const result = await fileListTool(agentId, agent.name, String(args.dir ?? "/"));
              toolResult = result.output;
            } else if (fnName === "code_exec") {
              const rawLang = String(args.language ?? "node");
              const lang: "node" | "python" = rawLang === "python" ? "python" : "node";
              const result = await codeExecTool(agentId, agent.name, String(args.code ?? ""), lang);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "send_email") {
              const result = await sendEmailTool(agentId, agent.name, String(args.to ?? ""), String(args.subject ?? ""), String(args.body ?? ""));
              toolResult = result.output;
            } else if (fnName === "delegate_to_agent") {
              const result = await delegateToAgentTool(agentId, agent.name, String(args.to_agent ?? ""), String(args.task ?? ""));
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "send_webhook") {
              const payload = (args.payload as Record<string, unknown>) ?? { message: args.message ?? "Agent notification" };
              const result = await sendWebhookTool(agentId, agent.name, payload);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "website_read") {
              const result = await websiteReadFileTool(agentId, agent.name, String(args.path ?? ""));
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "website_write") {
              const result = await websiteWriteFileTool(agentId, agent.name, String(args.path ?? ""), String(args.content ?? ""));
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "website_build") {
              const result = await websiteBuildTool(agentId, agent.name);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "website_deploy") {
              const result = await websiteDeployTool(agentId, agent.name);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "website_health") {
              const result = await websiteHealthCheckTool(agentId, agent.name);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "compose_pipeline") {
              const steps = (args.steps as Array<{ agent: string; task: string }>) ?? [];
              const result = await composePipelineTool(agentId, agent.name, steps);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "context_set") {
              const result = await contextSetTool(agentId, agent.name, String(args.namespace ?? ""), String(args.key ?? ""), args.value);
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            } else if (fnName === "context_get") {
              const result = await contextGetTool(agentId, agent.name, String(args.namespace ?? ""), String(args.key ?? ""));
              toolResult = result.output + (result.error ? `\nError: ${result.error}` : "");
            }
          } catch (toolErr) {
            toolResult = `Error: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`;
          }

          messages.push({ role: "tool" as const, content: toolResult, tool_call_id: tc.id });
        }
      } else {
        finalAnswer = msg.content ?? "";
        continueLoop = false;
      }
    }

    const answerBody = finalAnswer.replace(/FOLLOW_UPS:[\s\S]+$/, "").trim();

    await db.insert(agentConversationMessagesTable).values({
      conversationId: convId!,
      role: "assistant",
      content: answerBody,
      sourcesJson: sources.length > 0 ? sources : null,
    });

    if (delegationMessageId !== null) {
      await db
        .update(agentMessagesTable)
        .set({ response: answerBody })
        .where(eq(agentMessagesTable.id, delegationMessageId));
    }
  } finally {
    await setAgentStatus(agentId, "idle");
  }
}
