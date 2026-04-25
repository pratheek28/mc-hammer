import { useState, useEffect } from "react";

export function useGraphSocket(url: string) {
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");

  useEffect(() => {
    console.log("useEffect running, creating WebSocket...");
    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log("WebSocket opened successfully");
      setStatus("connected");
    };

    ws.onclose = (e) => {
      console.log("WebSocket closed", { code: e.code, reason: e.reason, wasClean: e.wasClean });
      setStatus("disconnected");
    };

    ws.onerror = (e) => {
      console.error("WebSocket error", e);
      setStatus("error");
    };

    ws.onmessage = (event) => {
      console.log("Message received:", event.data);
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "add_node":
          setNodes((prev) => [...prev, data.node]);
          break;
        case "add_edge":
          setEdges((prev) => [...prev, data.edge]);
          break;
      }
    };

    return () => {
      console.log("useEffect cleanup — closing WebSocket");
      ws.close();
    };
  }, [url]);

  return { nodes, edges, status };
}