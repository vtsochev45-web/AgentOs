import { describe, it, expect, vi } from "vitest";
import { batchProcess, batchProcessWithSSE, isRateLimitError } from "./utils";

describe("isRateLimitError", () => {
  it("detects 429 in error message", () => {
    expect(isRateLimitError(new Error("HTTP 429 Too Many Requests"))).toBe(
      true
    );
  });

  it("detects RATELIMIT_EXCEEDED token", () => {
    expect(isRateLimitError(new Error("RATELIMIT_EXCEEDED for model"))).toBe(
      true
    );
  });

  it("detects 'quota' regardless of casing", () => {
    expect(isRateLimitError(new Error("Monthly QUOTA reached"))).toBe(true);
    expect(isRateLimitError(new Error("quota exceeded"))).toBe(true);
  });

  it("detects 'rate limit' regardless of casing", () => {
    expect(isRateLimitError(new Error("Rate Limit hit"))).toBe(true);
    expect(isRateLimitError(new Error("rate limit reached"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isRateLimitError(new Error("ECONNRESET"))).toBe(false);
    expect(isRateLimitError(new Error("invalid json"))).toBe(false);
    expect(isRateLimitError(new Error("500 Internal Server Error"))).toBe(
      false
    );
  });

  it("handles non-Error inputs by stringifying", () => {
    expect(isRateLimitError("HTTP 429")).toBe(true);
    expect(isRateLimitError("nope")).toBe(false);
    expect(isRateLimitError(429)).toBe(true);
    expect(isRateLimitError({ toString: () => "rate limit" })).toBe(true);
  });

  it("handles null and undefined", () => {
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

describe("batchProcess", () => {
  const fastOpts = { retries: 0, minTimeout: 1, maxTimeout: 1 };

  it("returns results in input order", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await batchProcess(
      items,
      async (n) => {
        // Reverse delay so larger items resolve first; order should still match input.
        await new Promise((r) => setTimeout(r, (10 - n) * 2));
        return n * 2;
      },
      { ...fastOpts, concurrency: 5 }
    );
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("passes the index to the processor", async () => {
    const seen: Array<[string, number]> = [];
    await batchProcess(
      ["a", "b", "c"],
      async (item, index) => {
        seen.push([item, index]);
        return item;
      },
      { ...fastOpts, concurrency: 1 }
    );
    expect(seen).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("returns an empty array for empty input", async () => {
    const results = await batchProcess([], async () => "never", fastOpts);
    expect(results).toEqual([]);
  });

  it("respects the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const items = Array.from({ length: 6 }, (_, i) => i);

    const promise = batchProcess(
      items,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => release.push(resolve));
        inFlight--;
        return null;
      },
      { ...fastOpts, concurrency: 2 }
    );

    // Yield until the limiter has scheduled the initial batch.
    while (release.length < 2) await new Promise((r) => setTimeout(r, 0));
    expect(release.length).toBe(2);
    expect(peak).toBe(2);

    // Release tasks one by one; new ones should take their place up to the cap.
    while (release.length > 0) {
      release.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    await promise;
    expect(peak).toBe(2);
  });

  it("calls onProgress for each completed item with completed/total/item", async () => {
    const onProgress = vi.fn();
    await batchProcess(
      ["x", "y", "z"],
      async (item) => item.toUpperCase(),
      { ...fastOpts, concurrency: 1, onProgress }
    );
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3, "x");
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 3, "y");
    expect(onProgress).toHaveBeenNthCalledWith(3, 3, 3, "z");
  });

  it("retries on rate-limit errors and eventually succeeds", async () => {
    let attempts = 0;
    const results = await batchProcess(
      ["only"],
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("HTTP 429 Too Many Requests");
        return "ok";
      },
      { concurrency: 1, retries: 5, minTimeout: 1, maxTimeout: 2 }
    );
    expect(attempts).toBe(3);
    expect(results).toEqual(["ok"]);
  });

  it("does not retry non-rate-limit errors (aborts via AbortError)", async () => {
    let attempts = 0;
    await expect(
      batchProcess(
        ["only"],
        async () => {
          attempts++;
          throw new Error("ECONNRESET");
        },
        { concurrency: 1, retries: 5, minTimeout: 1, maxTimeout: 2 }
      )
    ).rejects.toThrow("ECONNRESET");
    expect(attempts).toBe(1);
  });

  it("wraps non-Error throws into Error before aborting", async () => {
    let attempts = 0;
    await expect(
      batchProcess(
        ["only"],
        async () => {
          attempts++;
          throw "string failure";
        },
        { concurrency: 1, retries: 5, minTimeout: 1, maxTimeout: 2 }
      )
    ).rejects.toThrow("string failure");
    expect(attempts).toBe(1);
  });

  it("gives up after the configured retry budget on rate-limit errors", async () => {
    let attempts = 0;
    await expect(
      batchProcess(
        ["only"],
        async () => {
          attempts++;
          throw new Error("HTTP 429");
        },
        { concurrency: 1, retries: 2, minTimeout: 1, maxTimeout: 2 }
      )
    ).rejects.toThrow("HTTP 429");
    // p-retry: 1 initial attempt + 2 retries
    expect(attempts).toBe(3);
  });
});

describe("batchProcessWithSSE", () => {
  const fastOpts = { retries: 0, minTimeout: 1, maxTimeout: 1 };

  it("emits started/processing/progress/complete events for each item", async () => {
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    const results = await batchProcessWithSSE(
      ["a", "b"],
      async (item) => item.toUpperCase(),
      (e) => events.push(e),
      fastOpts
    );

    expect(results).toEqual(["A", "B"]);
    expect(events[0]).toEqual({ type: "started", total: 2 });
    expect(events.at(-1)).toEqual({ type: "complete", processed: 2, errors: 0 });
    expect(events.filter((e) => e.type === "processing")).toHaveLength(2);
    expect(events.filter((e) => e.type === "progress")).toHaveLength(2);
    expect(events).toContainEqual({ type: "progress", index: 0, result: "A" });
    expect(events).toContainEqual({ type: "progress", index: 1, result: "B" });
  });

  it("continues after a failure, reports it, and counts errors", async () => {
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    const results = await batchProcessWithSSE<string, string>(
      ["good", "bad", "good"],
      async (item) => {
        if (item === "bad") throw new Error("boom");
        return item.toUpperCase();
      },
      (e) => events.push(e),
      fastOpts
    );

    expect(results).toEqual(["GOOD", undefined, "GOOD"]);
    const complete = events.at(-1)!;
    expect(complete).toEqual({ type: "complete", processed: 3, errors: 1 });
    expect(events).toContainEqual({
      type: "progress",
      index: 1,
      error: "boom",
    });
  });

  it("retries rate-limit errors before giving up", async () => {
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    let attempts = 0;
    const results = await batchProcessWithSSE<string, string>(
      ["only"],
      async () => {
        attempts++;
        if (attempts < 2) throw new Error("HTTP 429");
        return "ok";
      },
      (e) => events.push(e),
      { retries: 3, minTimeout: 1, maxTimeout: 2 }
    );
    expect(attempts).toBe(2);
    expect(results).toEqual(["ok"]);
    expect(events.at(-1)).toEqual({
      type: "complete",
      processed: 1,
      errors: 0,
    });
  });

  it("surfaces a normalized message when a non-Error is thrown", async () => {
    // p-retry normalizes non-Error throws into a TypeError before they reach
    // our handler, so the catch always sees an Error and emits its .message.
    // The "Processing failed" fallback in the catch is therefore unreachable
    // through the pRetry path — keeping this test pinned so a future change
    // to the retry library or wrapping logic doesn't silently change the
    // error payload that SSE consumers see.
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    const results = await batchProcessWithSSE<string, string>(
      ["x"],
      async () => {
        throw "plain string";
      },
      (e) => events.push(e),
      fastOpts
    );
    expect(results).toEqual([undefined]);
    const progress = events.find((e) => e.type === "progress");
    expect(progress).toBeDefined();
    expect(progress!.error).toMatch(/plain string/);
  });
});
