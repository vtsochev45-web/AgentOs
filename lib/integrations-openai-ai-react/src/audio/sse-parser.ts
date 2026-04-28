/**
 * Pure SSE parsing helpers for the voice stream.
 *
 * Lives in its own module so the parsing logic can be unit-tested
 * independently of the React hook that consumes it.
 */

export type TypedVoiceStreamEvent =
  | { type: "user_transcript"; data: string }
  | { type: "transcript"; data: string }
  | { type: "audio"; data: string }
  | { type: "error"; error: string };

export type DoneEvent = { done: true };

export type VoiceStreamEvent = TypedVoiceStreamEvent | DoneEvent;

const SSE_EVENT_DELIMITER = /\r\n\r\n|\n\n|\r\r/g;

export function isVoiceStreamEvent(value: unknown): value is VoiceStreamEvent {
  if (!value || typeof value !== "object") return false;

  const record = value as Record<string, unknown>;

  if (record.done === true) return true;

  switch (record.type) {
    case "user_transcript":
    case "transcript":
    case "audio":
      return typeof record.data === "string";
    case "error":
      return typeof record.error === "string";
    default:
      return false;
  }
}

export function parseVoiceStreamEvent(raw: string): VoiceStreamEvent {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Received malformed SSE JSON payload");
  }

  if (!isVoiceStreamEvent(parsed)) {
    throw new Error("Received unexpected SSE event shape");
  }

  return parsed;
}

export function readSseDataFromBlock(block: string): string | null {
  const normalizedBlock = block.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const dataLines: string[] = [];

  for (const line of normalizedBlock.split("\n")) {
    if (!line.startsWith("data:")) {
      continue;
    }

    // SSE allows one optional leading space after the colon.
    dataLines.push(line.slice(5).replace(/^ /, ""));
  }

  if (dataLines.length === 0) {
    return null;
  }

  return dataLines.join("\n");
}

export function extractCompleteSseBlocks(buffer: string): {
  blocks: string[];
  remaining: string;
} {
  const blocks: string[] = [];
  let lastIndex = 0;

  SSE_EVENT_DELIMITER.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SSE_EVENT_DELIMITER.exec(buffer)) !== null) {
    blocks.push(buffer.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
  }

  return {
    blocks,
    remaining: buffer.slice(lastIndex),
  };
}

export function isDoneEvent(event: VoiceStreamEvent): event is DoneEvent {
  return "done" in event && (event as DoneEvent).done === true;
}
