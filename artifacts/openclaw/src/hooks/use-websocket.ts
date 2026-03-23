import { useEffect, useRef, useState, useCallback } from "react";

export function useWebSocketTerminal(path: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onDataRef = useRef<((data: string) => void) | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Use absolute URL for WS to handle proxies nicely
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}${path}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string" && onDataRef.current) {
        onDataRef.current(event.data);
      } else if (event.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => {
          if (onDataRef.current && typeof reader.result === "string") {
            onDataRef.current(reader.result);
          }
        };
        reader.readAsText(event.data);
      }
    };

    ws.onerror = (e) => {
      console.error("WebSocket error:", e);
      setError("Connection error");
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;
    };
  }, [path]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setIsConnected(false);
    }
  }, []);

  const sendData = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  const onData = useCallback((callback: (data: string) => void) => {
    onDataRef.current = callback;
  }, []);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return { connect, disconnect, sendData, resize, onData, isConnected, error };
}
