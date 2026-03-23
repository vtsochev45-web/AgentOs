import { useState, useCallback, useRef } from "react";

export interface SSEMessage {
  type: string;
  data: string | number | string[] | Record<string, unknown>;
}

export interface ActivityEvent {
  id?: number;
  agentId?: number | null;
  agentName?: string | null;
  actionType: string;
  detail: string;
  timestamp?: string;
}

export function useSSEChat() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const streamChat = useCallback(async (
    agentId: number,
    content: string,
    conversationId: number | null,
    onMessage: (msg: SSEMessage) => void
  ) => {
    setIsStreaming(true);
    setError(null);
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`/api/agents/${agentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, conversationId }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error("Failed to start chat stream");
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const parsed = JSON.parse(dataStr) as SSEMessage;
              onMessage(parsed);
              if (parsed.type === "done") {
                setIsStreaming(false);
                return;
              }
            } catch {
              console.error("Failed to parse SSE JSON:", dataStr);
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        console.log("Chat stream aborted");
      } else {
        const message = err instanceof Error ? err.message : "Stream failed";
        console.error("Chat stream error:", err);
        setError(message);
      }
    } finally {
      setIsStreaming(false);
    }
  }, []);

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
  }, []);

  return { streamChat, stopStream, isStreaming, error };
}

export function useSSEActivity() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) return;

    const es = new EventSource("/api/activity/stream");
    eventSourceRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(e.data) as ActivityEvent;
        setEvents((prev) => [parsed, ...prev].slice(0, 100));
      } catch (err) {
        console.error("Failed to parse activity event", err);
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      eventSourceRef.current = null;
      setTimeout(connect, 3000);
    };
  }, []);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  }, []);

  return { events, isConnected, connect, disconnect };
}

export interface AgentStatusEvent {
  agentId: number;
  status: string;
}

export function useSSEAgentStatus(onStatusChange: (ev: AgentStatusEvent) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const connect = useCallback(() => {
    if (eventSourceRef.current) return;

    const es = new EventSource("/api/agents/stream");
    eventSourceRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(e.data) as AgentStatusEvent;
        onStatusChangeRef.current(parsed);
      } catch (err) {
        console.error("Failed to parse agent status event", err);
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      eventSourceRef.current = null;
      setTimeout(connect, 3000);
    };
  }, []);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  }, []);

  return { isConnected, connect, disconnect };
}
