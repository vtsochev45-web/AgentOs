import { useState, useCallback, useRef } from "react";

type SSEMessage = {
  type: string;
  data: any;
};

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
        buffer = lines.pop() || ""; // Keep the last incomplete chunk in the buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;
            
            try {
              const parsed = JSON.parse(dataStr);
              onMessage(parsed);
              if (parsed.type === "done") {
                setIsStreaming(false);
                return;
              }
            } catch (e) {
              console.error("Failed to parse SSE JSON:", dataStr);
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log("Chat stream aborted");
      } else {
        console.error("Chat stream error:", err);
        setError(err.message || "Stream failed");
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
  const [events, setEvents] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) return;

    const es = new EventSource("/api/activity/stream");
    eventSourceRef.current = es;

    es.onopen = () => setIsConnected(true);
    
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setEvents((prev) => [parsed, ...prev].slice(0, 100)); // Keep last 100
      } catch (err) {
        console.error("Failed to parse activity event", err);
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      eventSourceRef.current = null;
      setTimeout(connect, 3000); // Reconnect
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
