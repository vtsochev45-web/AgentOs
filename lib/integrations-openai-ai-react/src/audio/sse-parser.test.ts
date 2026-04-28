import { describe, it, expect } from "vitest";
import {
  extractCompleteSseBlocks,
  isDoneEvent,
  isVoiceStreamEvent,
  parseVoiceStreamEvent,
  readSseDataFromBlock,
} from "./sse-parser";

describe("extractCompleteSseBlocks", () => {
  it("returns no blocks and the full buffer as remaining when no delimiter present", () => {
    const { blocks, remaining } = extractCompleteSseBlocks("data: partial");
    expect(blocks).toEqual([]);
    expect(remaining).toBe("data: partial");
  });

  it("splits on \\n\\n", () => {
    const { blocks, remaining } = extractCompleteSseBlocks(
      "data: a\n\ndata: b\n\n"
    );
    expect(blocks).toEqual(["data: a", "data: b"]);
    expect(remaining).toBe("");
  });

  it("splits on \\r\\n\\r\\n", () => {
    const { blocks, remaining } = extractCompleteSseBlocks(
      "data: a\r\n\r\ndata: b\r\n\r\n"
    );
    expect(blocks).toEqual(["data: a", "data: b"]);
    expect(remaining).toBe("");
  });

  it("splits on \\r\\r", () => {
    const { blocks, remaining } = extractCompleteSseBlocks("data: a\r\rdata: b\r\r");
    expect(blocks).toEqual(["data: a", "data: b"]);
    expect(remaining).toBe("");
  });

  it("keeps an unterminated trailing block in remaining", () => {
    const { blocks, remaining } = extractCompleteSseBlocks(
      "data: complete\n\ndata: partial"
    );
    expect(blocks).toEqual(["data: complete"]);
    expect(remaining).toBe("data: partial");
  });

  it("returns empty results for an empty buffer", () => {
    const { blocks, remaining } = extractCompleteSseBlocks("");
    expect(blocks).toEqual([]);
    expect(remaining).toBe("");
  });

  it("is safe to call repeatedly on the same buffer (no leaked regex state)", () => {
    const buf = "data: a\n\ndata: b\n\n";
    const first = extractCompleteSseBlocks(buf);
    const second = extractCompleteSseBlocks(buf);
    expect(first).toEqual(second);
  });

  it("handles mixed delimiters in the same buffer", () => {
    const { blocks, remaining } = extractCompleteSseBlocks(
      "data: a\n\ndata: b\r\n\r\ndata: c"
    );
    expect(blocks).toEqual(["data: a", "data: b"]);
    expect(remaining).toBe("data: c");
  });
});

describe("readSseDataFromBlock", () => {
  it("returns null when the block has no data lines", () => {
    expect(readSseDataFromBlock("event: ping\nid: 7")).toBeNull();
    expect(readSseDataFromBlock("")).toBeNull();
  });

  it("strips the optional single space after the colon", () => {
    expect(readSseDataFromBlock("data: hello")).toBe("hello");
    expect(readSseDataFromBlock("data:hello")).toBe("hello");
  });

  it("preserves a second leading space (per SSE spec — only one is consumed)", () => {
    expect(readSseDataFromBlock("data:  hello")).toBe(" hello");
  });

  it("joins multi-line data with a single \\n", () => {
    expect(
      readSseDataFromBlock("data: line1\ndata: line2\ndata: line3")
    ).toBe("line1\nline2\nline3");
  });

  it("normalizes CRLF and CR line endings to LF before scanning", () => {
    expect(readSseDataFromBlock("data: a\r\ndata: b")).toBe("a\nb");
    expect(readSseDataFromBlock("data: a\rdata: b")).toBe("a\nb");
  });

  it("ignores non-data fields between data lines", () => {
    expect(
      readSseDataFromBlock("event: msg\ndata: a\nid: 1\ndata: b\nretry: 100")
    ).toBe("a\nb");
  });

  it("treats lines that don't start with 'data:' as fields, not data", () => {
    expect(readSseDataFromBlock(" data: indented")).toBeNull();
  });
});

describe("isVoiceStreamEvent", () => {
  it("accepts a done event", () => {
    expect(isVoiceStreamEvent({ done: true })).toBe(true);
  });

  it("accepts each typed event with a string data field", () => {
    expect(
      isVoiceStreamEvent({ type: "user_transcript", data: "hello" })
    ).toBe(true);
    expect(isVoiceStreamEvent({ type: "transcript", data: "hi" })).toBe(true);
    expect(isVoiceStreamEvent({ type: "audio", data: "AAAA" })).toBe(true);
  });

  it("accepts an error event with a string error field", () => {
    expect(isVoiceStreamEvent({ type: "error", error: "boom" })).toBe(true);
  });

  it("rejects events with the wrong field type", () => {
    expect(isVoiceStreamEvent({ type: "transcript", data: 42 })).toBe(false);
    expect(isVoiceStreamEvent({ type: "error", error: 42 })).toBe(false);
    expect(isVoiceStreamEvent({ type: "audio" })).toBe(false);
  });

  it("rejects unknown types", () => {
    expect(isVoiceStreamEvent({ type: "metadata", data: "x" })).toBe(false);
  });

  it("rejects falsy / non-object values", () => {
    expect(isVoiceStreamEvent(null)).toBe(false);
    expect(isVoiceStreamEvent(undefined)).toBe(false);
    expect(isVoiceStreamEvent("string")).toBe(false);
    expect(isVoiceStreamEvent(0)).toBe(false);
  });

  it("rejects done flag that isn't strictly true", () => {
    expect(isVoiceStreamEvent({ done: 1 })).toBe(false);
    expect(isVoiceStreamEvent({ done: "true" })).toBe(false);
  });
});

describe("parseVoiceStreamEvent", () => {
  it("parses valid JSON for a typed event", () => {
    expect(
      parseVoiceStreamEvent('{"type":"transcript","data":"hi"}')
    ).toEqual({ type: "transcript", data: "hi" });
  });

  it("parses a done event", () => {
    expect(parseVoiceStreamEvent('{"done":true}')).toEqual({ done: true });
  });

  it("throws a malformed-payload error for invalid JSON", () => {
    expect(() => parseVoiceStreamEvent("{not json")).toThrow(
      /malformed SSE JSON payload/
    );
  });

  it("throws an unexpected-shape error for valid JSON with the wrong shape", () => {
    expect(() =>
      parseVoiceStreamEvent('{"type":"unknown","data":"x"}')
    ).toThrow(/unexpected SSE event shape/);
    expect(() => parseVoiceStreamEvent('{"foo":1}')).toThrow(
      /unexpected SSE event shape/
    );
  });
});

describe("isDoneEvent", () => {
  it("returns true for {done: true}", () => {
    expect(isDoneEvent({ done: true })).toBe(true);
  });

  it("returns false for typed events", () => {
    expect(isDoneEvent({ type: "transcript", data: "x" })).toBe(false);
    expect(isDoneEvent({ type: "audio", data: "AAAA" })).toBe(false);
    expect(isDoneEvent({ type: "error", error: "boom" })).toBe(false);
  });
});
