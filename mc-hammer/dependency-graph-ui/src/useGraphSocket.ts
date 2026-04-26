import { useState, useEffect, useRef } from "react";
import type { Node, Edge } from "reactflow";
import { sendGraphPayloadToBackendRelay } from "./backendCommandSocket";

type Status = "connecting" | "connected" | "receiving" | "done" | "error" | "disconnected";

export function useGraphSocket(url: string) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const nodeCountRef = useRef(0);
  const edgeCountRef = useRef(0);

  const relayToBackend = (payload: Record<string, unknown>) => {
    sendGraphPayloadToBackendRelay<{ ok?: boolean; upstream?: unknown; error?: unknown }>(payload)
      .then((response) => {
        if (response?.ok) {
          console.log("[useGraphSocket] Relay success via backend", response.upstream ?? {});
          return;
        }
        console.error("[useGraphSocket] Relay failed via backend", response?.error ?? "unknown error");
      })
      .catch((error) => {
        console.error("[useGraphSocket] Relay request error", error);
      });
  };

  useEffect(() => {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setStatus("connected");
      console.log("[useGraphSocket] Connected to backend graph stream");
      relayToBackend({
        type: "graph-stream-opened",
        source: "dependency-graph-ui/useGraphSocket",
        graph_ws_url: url,
      });
    };

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
        nodeCountRef.current = 0;
        edgeCountRef.current = 0;
        console.log("[useGraphSocket] Graph stream started", {
          expectedNodes: msg.nodeCount ?? null,
          expectedEdges: msg.edgeCount ?? null,
        });
      } else if (msg.type === "add_node") {
        setNodes((prev) => [...prev, msg.node]);
        nodeCountRef.current += 1;
      } else if (msg.type === "add_edge") {
        setEdges((prev) => [...prev, msg.edge]);
        edgeCountRef.current += 1;
      } else if (msg.type === "done") {
        setStatus("done");
        console.log("[useGraphSocket] Graph stream complete", {
          nodes: nodeCountRef.current,
          edges: edgeCountRef.current,
        });
        relayToBackend({
          type: "graph-stream-complete",
          source: "dependency-graph-ui/useGraphSocket",
          graph_ws_url: url,
          nodes: nodeCountRef.current,
          edges: edgeCountRef.current,
        });
      } else if (msg.type === "error") {
        setStatus("error");
        console.error("[useGraphSocket] Backend graph stream error", msg.message ?? "unknown");
        relayToBackend({
          type: "graph-stream-error",
          source: "dependency-graph-ui/useGraphSocket",
          graph_ws_url: url,
          message: msg.message ?? "unknown",
        });
      }
    };

    ws.onerror = () => {
      setStatus("error");
      console.error("[useGraphSocket] Socket transport error");
    };
    ws.onclose = () => {
      setStatus("disconnected");
      console.log("[useGraphSocket] Socket closed");
    };

    return () => ws.close();
  }, [url]);

  return { nodes, edges, status };
}