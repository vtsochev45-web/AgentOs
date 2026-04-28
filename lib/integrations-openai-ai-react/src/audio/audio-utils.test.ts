import { describe, it, expect } from "vitest";
import { decodePCM16ToFloat32 } from "./audio-utils";

function encodeInt16LE(samples: number[]): string {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(i * 2, samples[i], /* littleEndian */ true);
  }
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

describe("decodePCM16ToFloat32", () => {
  it("returns an empty Float32Array for an empty payload", () => {
    const out = decodePCM16ToFloat32("");
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(0);
  });

  it("decodes a single zero sample to 0", () => {
    const out = decodePCM16ToFloat32(encodeInt16LE([0]));
    expect(out.length).toBe(1);
    expect(out[0]).toBe(0);
  });

  it("decodes Int16 max (32767) to just under +1", () => {
    const out = decodePCM16ToFloat32(encodeInt16LE([32767]));
    // Implementation divides by 32768, so the positive peak is 32767/32768.
    expect(out[0]).toBeCloseTo(32767 / 32768, 6);
    expect(out[0]).toBeLessThan(1);
  });

  it("decodes Int16 min (-32768) to exactly -1", () => {
    const out = decodePCM16ToFloat32(encodeInt16LE([-32768]));
    expect(out[0]).toBe(-1);
  });

  it("preserves sample order (little-endian decode)", () => {
    const samples = [0, 100, -100, 16384, -16384, 32767, -32768];
    const out = decodePCM16ToFloat32(encodeInt16LE(samples));
    expect(out.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i++) {
      expect(out[i]).toBeCloseTo(samples[i] / 32768, 6);
    }
  });

  it("returns a Float32Array of pcm16-sample length (2 bytes → 1 sample)", () => {
    const out = decodePCM16ToFloat32(encodeInt16LE([1, 2, 3, 4]));
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(4);
  });

  it("throws on invalid base64 input", () => {
    expect(() => decodePCM16ToFloat32("!!!not-base64!!!")).toThrow();
  });
});
