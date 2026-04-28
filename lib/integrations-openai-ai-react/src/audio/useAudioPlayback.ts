/**
 * React hook for streaming audio playback using AudioWorklet.
 * Supports real-time PCM16 audio streaming from SSE responses.
 * Includes sequence buffer for reordering out-of-order chunks.
 */
import { useRef, useCallback, useState } from "react";
import { decodePCM16ToFloat32 } from "./audio-utils";
import { SequenceBuffer } from "./SequenceBuffer";

export type PlaybackState = "idle" | "playing" | "ended";

export function useAudioPlayback(workletPath: string) {
  const [state, setState] = useState<PlaybackState>("idle");
  const ctxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const readyRef = useRef(false);
  const seqBufferRef = useRef(new SequenceBuffer());

  const init = useCallback(async () => {
    if (readyRef.current) return;
    if (!workletPath) {
      throw new Error("workletPath is required for audio playback");
    }

    const ctx = new AudioContext({ sampleRate: 24000 });
    await ctx.audioWorklet.addModule(workletPath);
    const worklet = new AudioWorkletNode(ctx, "audio-playback-processor");
    worklet.connect(ctx.destination);

    worklet.port.onmessage = (e) => {
      if (e.data.type === "ended") setState("idle");
    };

    ctxRef.current = ctx;
    workletRef.current = worklet;
    readyRef.current = true;
  }, [workletPath]);

  /** Push audio directly (no sequencing) - for simple streaming */
  const pushAudio = useCallback((base64Audio: string) => {
    if (!workletRef.current) return;
    const samples = decodePCM16ToFloat32(base64Audio);
    workletRef.current.port.postMessage({ type: "audio", samples });
    setState("playing");
  }, []);

  /** Push audio with sequence number - reorders before playback */
  const pushSequencedAudio = useCallback((seq: number, base64Audio: string) => {
    if (!workletRef.current) return;

    const readyChunks = seqBufferRef.current.push(seq, base64Audio);
    for (const chunk of readyChunks) {
      const samples = decodePCM16ToFloat32(chunk);
      workletRef.current.port.postMessage({ type: "audio", samples });
    }
    if (readyChunks.length > 0) {
      setState("playing");
    }
  }, []);

  const signalComplete = useCallback(() => {
    workletRef.current?.port.postMessage({ type: "streamComplete" });
  }, []);

  const clear = useCallback(() => {
    workletRef.current?.port.postMessage({ type: "clear" });
    seqBufferRef.current.reset();
    setState("idle");
  }, []);

  return { state, init, pushAudio, pushSequencedAudio, signalComplete, clear };
}
