import { openai } from "@workspace/integrations-openai-ai-server";

type ChatMsg =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "tool"; content: string; tool_call_id: string };
import { db } from "@workspace/db";
import {
  agentsTable,
  agentConversationsTable,
  agentConversationMessagesTable,
  activityLogTable,
  appSettingsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { type Response } from "express";
import {
  webSearchTool,
  vpsShellTool,
  fileReadTool,
  fileWriteTool,
  fileListTool,
  codeExecTool,
  sendEmailTool,
} from "./agentTools";
import { emitActivity } from "./activityEmitter";
import { emitAgentStatus } from "./activityEmitter";

function sendEvent(res: Response, data: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function setAgentStatus(agentId: number, status: string): Promise<void> {
  await db.update(agentsTable).set({ status, lastActiveAt: new Date() }).where(eq(agentsTable.id, agentId));
  emitAgentStatus({ agentId, status });
}

export async function runAgentChat(
  agentId: number,
  userMessage: string,
  conversationId: number | null,
  res: Response
): Promise<void> {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) {
    sendEvent(res, { type: "error", data: "Agent not found" });
    res.end();
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
  sendEvent(res, { type: "step", data: "Analysing your request..." });

  await emitActivity({
    agentId,
    agentName: agent.name,
    actionType: "chat",
    detail: `Received: "${userMessage.substring(0, 100)}"`,
    timestamp: new Date().toISOString(),
  });

  const tools = buildToolDefinitions(toolsEnabled);
  const sources: Array<{ title: string; url: string; snippet: string; favicon?: string | null }> = [];

  const messages: ChatMsg[] = [
    {
      role: "system",
      content: `You are ${agent.name}. ${agent.persona}

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

  try {
    let continueLoop = true;
    let iterations = 0;

    while (continueLoop && iterations < 5) {
      iterations++;

      const completion = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 8192,
        messages: messages as Parameters<typeof openai.chat.completions.create>[0]["messages"],
        ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
        stream: false,
      });

      const choice = completion.choices[0];
      if (!choice) break;

      const msg = choice.message;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push({ role: "assistant" as const, content: msg.content ?? "" });

        for (const toolCall of msg.tool_calls) {
          const tc = toolCall as { id: string; type: "function"; function: { name: string; arguments: string } };
          const fnName = tc.function.name;
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments); } catch {}

          sendEvent(res, { type: "step", data: getToolStepMessage(fnName, args) });
          await setAgentStatus(agentId, getToolStatus(fnName));

          let toolResult = "";

          try {
            if (fnName === "web_search") {
              const result = await webSearchTool(String(args.query ?? ""), agentId, agent.name);
              toolResult = result.output;
              if (result.sources) {
                sources.push(...result.sources);
                for (const src of result.sources) {
                  sendEvent(res, { type: "source", data: src });
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
    sendEvent(res, { type: "step", data: "Composing answer..." });

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
        sendEvent(res, { type: "content", data: chunk });
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
      sendEvent(res, { type: "followups", data: followups.slice(0, 3) });
    }

    sendEvent(res, { type: "conversationId", data: convId });
    sendEvent(res, { type: "done" });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    sendEvent(res, { type: "error", data: errMsg });
  } finally {
    await setAgentStatus(agentId, "idle");
    res.end();
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
    default: return `Using tool: ${fnName}`;
  }
}

function getToolStatus(fnName: string): string {
  if (fnName === "web_search") return "searching";
  if (fnName === "vps_shell" || fnName === "code_exec") return "executing";
  if (fnName.startsWith("file_")) return "writing";
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
  ];

  const toolMap: Record<string, typeof all[0]> = {
    web_search: all[0]!,
    vps_shell: all[1]!,
    file_read: all[2]!,
    file_write: all[3]!,
    file_list: all[4]!,
    code_exec: all[5]!,
    send_email: all[6]!,
  };

  if (toolsEnabled.includes("all") || toolsEnabled.length === 0) return all;
  return toolsEnabled.map((t) => toolMap[t]).filter(Boolean) as typeof all;
}
