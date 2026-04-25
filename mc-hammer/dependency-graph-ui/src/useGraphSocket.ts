import { useState, useEffect } from "react";
import type { Node, Edge } from "reactflow";

type Status = "connecting" | "connected" | "receiving" | "done" | "error" | "disconnected";

export function useGraphSocket(url: string) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    const ws = new WebSocket(url);

    ws.onopen = () => setStatus("connected");

    ws.onmessage = (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      if (msg.type === "start") {
        setStatus("receiving");
        setNodes([]);
        setEdges([]);
      } else if (msg.type === "add_node") {
        setNodes((prev) => [...prev, msg.node]);
      } else if (msg.type === "add_edge") {
        setEdges((prev) => [...prev, msg.edge]);
      } else if (msg.type === "done") {
        setStatus("done");
      } else if (msg.type === "error") {
        setStatus("error");
      }
    };

    ws.onerror = () => setStatus("error");
    ws.onclose = () => setStatus("disconnected");

    return () => ws.close();
  }, [url]);

  return { nodes, edges, status };
}