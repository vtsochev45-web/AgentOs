import { describe, it, expect } from "vitest";
import { SequenceBuffer } from "./SequenceBuffer";

describe("SequenceBuffer", () => {
  it("returns chunks immediately when they arrive in order", () => {
    const buf = new SequenceBuffer();
    expect(buf.push(0, "a")).toEqual(["a"]);
    expect(buf.push(1, "b")).toEqual(["b"]);
    expect(buf.push(2, "c")).toEqual(["c"]);
  });

  it("buffers out-of-order chunks until the gap is filled", () => {
    const buf = new SequenceBuffer();
    expect(buf.push(2, "c")).toEqual([]);
    expect(buf.push(0, "a")).toEqual(["a"]);
    // pushing seq 1 should drain 1 then 2
    expect(buf.push(1, "b")).toEqual(["b", "c"]);
  });

  it("handles the example scenario from the docstring (2, 0, 1)", () => {
    const buf = new SequenceBuffer();
    expect(buf.push(2, "c")).toEqual([]);
    expect(buf.push(0, "a")).toEqual(["a"]);
    expect(buf.push(1, "b")).toEqual(["b", "c"]);
  });

  it("supports multiple chunks pushed under the same sequence number", () => {
    const buf = new SequenceBuffer();
    // Stash several chunks under seq 2 while seqs 0 and 1 are still missing,
    // then unblock the queue and confirm both seq-2 chunks drain in arrival order.
    expect(buf.push(2, "c1")).toEqual([]);
    expect(buf.push(2, "c2")).toEqual([]);
    expect(buf.push(1, "b")).toEqual([]);
    expect(buf.push(0, "a")).toEqual(["a", "b", "c1", "c2"]);
  });

  it("queues multiple deferred sequences and drains them on gap fill", () => {
    const buf = new SequenceBuffer();
    expect(buf.push(1, "b")).toEqual([]);
    expect(buf.push(2, "c")).toEqual([]);
    expect(buf.push(3, "d")).toEqual([]);
    expect(buf.push(0, "a")).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps later chunks buffered while a gap remains", () => {
    const buf = new SequenceBuffer();
    expect(buf.push(0, "a")).toEqual(["a"]);
    // seq 1 missing; seq 2 should be held.
    expect(buf.push(2, "c")).toEqual([]);
    expect(buf.push(3, "d")).toEqual([]);
    expect(buf.push(1, "b")).toEqual(["b", "c", "d"]);
  });

  it("does not advance past an unfilled gap when later chunks land first", () => {
    const buf = new SequenceBuffer();
    // 0 plays, then a gap at 1 holds everything.
    expect(buf.push(0, "a")).toEqual(["a"]);
    expect(buf.push(2, "c")).toEqual([]);
    expect(buf.push(4, "e")).toEqual([]);
    // Filling 1 and 3 in non-monotonic order still drains correctly.
    expect(buf.push(3, "d")).toEqual([]);
    expect(buf.push(1, "b")).toEqual(["b", "c", "d", "e"]);
  });

  it("reset() clears pending chunks and rewinds the next sequence to 0", () => {
    const buf = new SequenceBuffer();
    buf.push(2, "c");
    buf.push(0, "a");
    buf.reset();
    // After reset, the buffer should accept a fresh stream starting at 0.
    expect(buf.push(0, "x")).toEqual(["x"]);
    expect(buf.push(1, "y")).toEqual(["y"]);
  });

  it("reset() drops chunks that were buffered behind a gap", () => {
    const buf = new SequenceBuffer();
    expect(buf.push(1, "b")).toEqual([]);
    expect(buf.push(2, "c")).toEqual([]);
    buf.reset();
    // Old seq 1/2 should not leak into the new stream.
    expect(buf.push(0, "a")).toEqual(["a"]);
  });

  it("treats duplicate sequence numbers as additional chunks for that slot", () => {
    const buf = new SequenceBuffer();
    expect(buf.push(0, "a1")).toEqual(["a1"]);
    // A duplicate seq 0 arriving after the slot has advanced is buffered
    // (nextSeq is now 1, so the duplicate is parked under key 0 and never drained).
    expect(buf.push(0, "a2")).toEqual([]);
    // The stream still advances normally.
    expect(buf.push(1, "b")).toEqual(["b"]);
  });
});
