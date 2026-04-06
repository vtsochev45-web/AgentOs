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

// ── Shared helpers ───────────────────────────────────────────

async function setAgentStatus(agentId: number, status: string): Promise<void> {
  await db.update(agentsTable).set({ status, lastActiveAt: new Date() }).where(eq(agentsTable.id, agentId));
  emitAgentStatus({ agentId, status });
}

async function getConfiguredModel(): Promise<string> {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  return settings?.aiModel ?? "google/gemini-2.5-flash";
}

interface AgentRunConfig {
  agentId: number;
  userMessage: string;
  conversationId: number | null;
  jobId: string | null;           // null = internal run (no event emission)
  delegationMessageId: number | null;
  maxTokens: number;
  emitEvents: boolean;
}

function emit(config: AgentRunConfig, type: string, data: unknown): void {
  if (config.emitEvents && config.jobId) {
    emitJobEvent(config.jobId, type, data);
  }
}

// ── Core agent loop (shared by public + internal) ────────────

async function executeAgentRun(config: AgentRunConfig): Promise<void> {
  const { agentId, userMessage, delegationMessageId, maxTokens } = config;

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) {
    emit(config, "error", "Agent not found");
    emit(config, "done", null);
    return;
  }

  const toolsEnabled = (agent.toolsEnabled ?? []) as string[];

  let convId = config.conversationId;
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
  emit(config, "step", "Analysing your request...");

  if (config.emitEvents) {
    void persistAndEmitActivity({
      agentId,
      agentName: agent.name,
      actionType: "chat",
      detail: `Received: "${userMessage.substring(0, 100)}"`,
      timestamp: new Date().toISOString(),
    });
  }

  const tools = buildToolDefinitions(toolsEnabled);
  const sources: Array<{ title: string; url: string; snippet: string; favicon?: string | null }> = [];

  // Load agent memories
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
        max_completion_tokens: maxTokens,
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
          const tc = toolCall as ToolCallDef;
          const fnName = tc.function.name;
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}

          emit(config, "step", getToolStepMessage(fnName, args));
          await setAgentStatus(agentId, getToolStatus(fnName));

          let toolResult = "";

          try {
            toolResult = await executeTool(fnName, args, agentId, agent.name);

            if (fnName === "web_search") {
              const parsed = JSON.parse(toolResult) as { output: string; sources?: typeof sources };
              toolResult = parsed.output;
              if (parsed.sources) {
                sources.push(...parsed.sources);
                for (const src of parsed.sources) emit(config, "source", src);
              }
            }
          } catch (err) {
            toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }

          messages.push({ role: "tool" as const, content: toolResult, tool_call_id: tc.id });
        }
      } else {
        finalAnswer = msg.content ?? "";
        continueLoop = false;
      }
    }

    await setAgentStatus(agentId, "writing");
    emit(config, "step", "Composing answer...");

    // Extract follow-ups
    const followupMatch = finalAnswer.match(/FOLLOW_UPS:([\s\S]+)$/);
    let answerBody = finalAnswer;
    const followups: string[] = [];

    if (followupMatch) {
      answerBody = finalAnswer.replace(/FOLLOW_UPS:[\s\S]+$/, "").trim();
      const followupText = followupMatch[1] ?? "";
      for (const line of followupText.split("\n").filter((l) => l.trim())) {
        const q = line.replace(/^\d+[\.\)]\s*/, "").trim();
        if (q) followups.push(q);
      }
    }

    // Stream answer chunks
    const chunks = answerBody.split(/(?<=\. )|(?<=\n)/);
    for (const chunk of chunks) {
      if (chunk) {
        emit(config, "content", chunk);
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    // Save to DB
    await db.insert(agentConversationMessagesTable).values({
      conversationId: convId!,
      role: "assistant",
      content: answerBody,
      sourcesJson: sources.length > 0 ? sources : null,
    });

    if (followups.length > 0) emit(config, "followups", followups.slice(0, 3));

    emit(config, "conversationId", convId);
    emit(config, "done", null);

    // Update delegation response if applicable
    if (delegationMessageId !== null) {
      await db.update(agentMessagesTable).set({ response: answerBody }).where(eq(agentMessagesTable.id, delegationMessageId));
    }

    // Reflection
    reflectOnInteraction(agentId, agent.name, userMessage, answerBody, config.jobId || "internal").catch(() => {});
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    emit(config, "error", errMsg);
    emit(config, "done", null);
  } finally {
    await setAgentStatus(agentId, "idle");
  }
}

// ── Tool execution (single dispatch) ─────────────────────────

async function executeTool(fnName: string, args: Record<string, unknown>, agentId: number, agentName: string): Promise<string> {
  switch (fnName) {
    case "web_search": {
      const result = await webSearchTool(String(args.query ?? ""), agentId, agentName);
      return JSON.stringify(result); // Parsed by caller for sources
    }
    case "vps_shell": {
      const r = await vpsShellTool(String(args.command ?? ""), agentId, agentName);
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "file_read": {
      const r = await fileReadTool(agentId, agentName, String(args.path ?? ""));
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "file_write": {
      const r = await fileWriteTool(agentId, agentName, String(args.path ?? ""), String(args.content ?? ""));
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "file_list": {
      const r = await fileListTool(agentId, agentName, String(args.dir ?? "/"));
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "code_exec": {
      const lang = String(args.language ?? "node") as "node" | "python";
      const r = await codeExecTool(agentId, agentName, String(args.code ?? ""), lang);
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "send_email": {
      const r = await sendEmailTool(agentId, agentName, String(args.to ?? ""), String(args.subject ?? ""), String(args.body ?? ""));
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "delegate_to_agent": {
      const r = await delegateToAgentTool(agentId, agentName, String(args.to_agent ?? ""), String(args.task ?? ""));
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "send_webhook": {
      const payload = (args.payload as Record<string, unknown>) ?? { message: args.message ?? "Agent notification" };
      const r = await sendWebhookTool(agentId, agentName, payload);
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "website_read": {
      const r = await websiteReadFileTool(agentId, agentName, String(args.path ?? ""));
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "website_write": {
      const r = await websiteWriteFileTool(agentId, agentName, String(args.path ?? ""), String(args.content ?? ""));
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "website_build": {
      const r = await websiteBuildTool(agentId, agentName);
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "website_deploy": {
      const r = await websiteDeployTool(agentId, agentName);
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "website_health": {
      const r = await websiteHealthCheckTool(agentId, agentName);
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "compose_pipeline": {
      const steps = (args.steps as Array<{ agent: string; task: string }>) ?? [];
      const r = await composePipelineTool(agentId, agentName, steps);
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "context_set": {
      const r = await contextSetTool(agentId, agentName, String(args.namespace ?? ""), String(args.key ?? ""), args.value);
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    case "context_get": {
      const r = await contextGetTool(agentId, agentName, String(args.namespace ?? ""), String(args.key ?? ""));
      return r.output + (r.error ? `\nError: ${r.error}` : "");
    }
    default:
      return `Unknown tool: ${fnName}`;
  }
}

// ── Public API ────────────────────────────────────────────────

export async function runAgentChat(
  jobId: string,
  agentId: number,
  userMessage: string,
  conversationId: number | null,
): Promise<void> {
  return executeAgentRun({
    agentId, userMessage, conversationId,
    jobId, delegationMessageId: null,
    maxTokens: 8192, emitEvents: true,
  });
}

export async function runAgentChatInternal(
  agentId: number,
  userMessage: string,
  conversationId: number | null,
  delegationMessageId: number | null,
): Promise<void> {
  return executeAgentRun({
    agentId, userMessage, conversationId,
    jobId: null, delegationMessageId,
    maxTokens: 4096, emitEvents: false,
  });
}

// ── Tool definitions & helpers ────────────────────────────────

function getToolStepMessage(fnName: string, args: Record<string, unknown>): string {
  switch (fnName) {
    case "web_search": return `Searching web for "${args.query}"...`;
    case "vps_shell": return `Running command: ${args.command}`;
    case "file_read": return `Reading file: ${args.path}`;
    case "file_write": return `Writing file: ${args.path}`;
    case "file_list": return `Listing files in: ${args.dir ?? "/"}`;
    case "code_exec": return `Executing ${args.language ?? "node"} code...`;
    case "send_email": return `Sending email to ${args.to}...`;
    case "delegate_to_agent": return `Delegating to ${args.to_agent}...`;
    case "compose_pipeline": return `Running pipeline...`;
    case "context_set": return `Setting context: ${args.namespace}/${args.key}`;
    case "context_get": return `Reading context: ${args.namespace}/${args.key}`;
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
  if (fnName === "delegate_to_agent" || fnName === "compose_pipeline") return "delegating";
  return "thinking";
}

function buildToolDefinitions(toolsEnabled: string[]) {
  const all = [
    { type: "function" as const, function: { name: "web_search", description: "Search the web for information. Returns structured results with titles, URLs, and snippets.", parameters: { type: "object", properties: { query: { type: "string", description: "Search query" } }, required: ["query"] } } },
    { type: "function" as const, function: { name: "vps_shell", description: "Run a shell command on the VPS and return the output.", parameters: { type: "object", properties: { command: { type: "string", description: "Shell command to execute" } }, required: ["command"] } } },
    { type: "function" as const, function: { name: "file_read", description: "Read a file from the agent's sandboxed workspace.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative file path" } }, required: ["path"] } } },
    { type: "function" as const, function: { name: "file_write", description: "Write content to a file in the agent's sandboxed workspace.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative file path" }, content: { type: "string", description: "File content" } }, required: ["path", "content"] } } },
    { type: "function" as const, function: { name: "file_list", description: "List files in a directory in the agent's sandboxed workspace.", parameters: { type: "object", properties: { dir: { type: "string", description: "Directory path (default: /)" } } } } },
    { type: "function" as const, function: { name: "code_exec", description: "Execute a code snippet and return the output.", parameters: { type: "object", properties: { code: { type: "string", description: "Code to execute" }, language: { type: "string", enum: ["node", "python"], description: "Language" } }, required: ["code"] } } },
    { type: "function" as const, function: { name: "send_email", description: "Send an email via configured SMTP.", parameters: { type: "object", properties: { to: { type: "string", description: "Recipient email" }, subject: { type: "string", description: "Email subject" }, body: { type: "string", description: "Email body text" } }, required: ["to", "subject", "body"] } } },
    { type: "function" as const, function: { name: "delegate_to_agent", description: "Delegate a subtask to another agent by name. The agent will process it and return its response synchronously.", parameters: { type: "object", properties: { to_agent: { type: "string", description: "Exact name of the target agent" }, task: { type: "string", description: "The task to send" } }, required: ["to_agent", "task"] } } },
    { type: "function" as const, function: { name: "send_webhook", description: "Send a webhook notification to the configured webhook URL with a custom payload.", parameters: { type: "object", properties: { payload: { type: "object", description: "JSON payload" } }, required: ["payload"] } } },
    { type: "function" as const, function: { name: "website_read", description: "Read a file from the website directory on the VPS via SFTP.", parameters: { type: "object", properties: { path: { type: "string", description: "Full path to the file" } }, required: ["path"] } } },
    { type: "function" as const, function: { name: "website_write", description: "Write/overwrite a file in the website directory on the VPS via SFTP.", parameters: { type: "object", properties: { path: { type: "string", description: "Full path to the file" }, content: { type: "string", description: "New file content" } }, required: ["path", "content"] } } },
    { type: "function" as const, function: { name: "website_build", description: "Run the configured build command in the website directory.", parameters: { type: "object", properties: {} } } },
    { type: "function" as const, function: { name: "website_deploy", description: "Run the configured deploy command for the website.", parameters: { type: "object", properties: {} } } },
    { type: "function" as const, function: { name: "website_health", description: "HTTP health check on the website URL.", parameters: { type: "object", properties: {} } } },
    { type: "function" as const, function: { name: "compose_pipeline", description: "Run a sequence of agents as a pipeline. Each step's output feeds the next via {previous_result}. Max 5 steps.", parameters: { type: "object", properties: { steps: { type: "array", items: { type: "object", properties: { agent: { type: "string", description: "Agent name" }, task: { type: "string", description: "Task. Use {previous_result} for chaining." } }, required: ["agent", "task"] }, description: "Pipeline steps" } }, required: ["steps"] } } },
    { type: "function" as const, function: { name: "context_set", description: "Store a key-value pair in a shared namespace visible to all agents.", parameters: { type: "object", properties: { namespace: { type: "string", description: "Namespace" }, key: { type: "string", description: "Key" }, value: { description: "Value (any JSON)" } }, required: ["namespace", "key", "value"] } } },
    { type: "function" as const, function: { name: "context_get", description: "Retrieve a value from a shared namespace.", parameters: { type: "object", properties: { namespace: { type: "string", description: "Namespace" }, key: { type: "string", description: "Key" } }, required: ["namespace", "key"] } } },
  ];

  const toolMap: Record<string, typeof all[0]> = {};
  for (const t of all) toolMap[t.function.name] = t;

  if (toolsEnabled.includes("all") || toolsEnabled.length === 0) return all;
  return toolsEnabled.map((t) => toolMap[t]).filter(Boolean) as typeof all;
}
