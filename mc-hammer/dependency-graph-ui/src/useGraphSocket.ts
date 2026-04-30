import { useState, useEffect, useRef } from "react";
import type { Node, Edge } from "reactflow";
import { sendGraphPayloadToBackendRelay } from "./backendCommandSocket";

type Status = "connecting" | "connected" | "receiving" | "done" | "error" | "disconnected";

const FALLBACK_NODES: Node[] = [
  { id: "fallback-root", data: { label: "merge_entrypoint" }, position: { x: 0, y: 0 } },
  { id: "fallback-tests", data: { label: "generate_tests" }, position: { x: -220, y: 170 } },
  { id: "fallback-merge", data: { label: "generate_merge" }, position: { x: 220, y: 170 } },
];

const FALLBACK_EDGES: Edge[] = [
  { id: "fallback-edge-tests", source: "fallback-root", target: "fallback-tests" },
  { id: "fallback-edge-merge", source: "fallback-root", target: "fallback-merge" },
];
const GRAPH_START_TIMEOUT_MS = 6000;
const LIVE_GRAPH_RETRY_MS = 2200;

export function useGraphSocket(url: string) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [usingFallback, setUsingFallback] = useState(false);
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
    let disposed = false;
    let activeSocket: WebSocket | null = null;
    let startTimeoutId: number | null = null;
    let reconnectTimeoutId: number | null = null;

    const clearTimers = () => {
      if (startTimeoutId !== null) {
        window.clearTimeout(startTimeoutId);
        startTimeoutId = null;
      }
      if (reconnectTimeoutId !== null) {
        window.clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimeoutId !== null) {
        return;
      }
      reconnectTimeoutId = window.setTimeout(() => {
        reconnectTimeoutId = null;
        connect();
      }, LIVE_GRAPH_RETRY_MS);
    };

    const connect = () => {
      if (disposed) {
        return;
      }
      clearTimers();
      const ws = new WebSocket(url);
      activeSocket = ws;
      let sawStreamStart = false;
      let streamSource: "fallback" | "live" = "live";

      startTimeoutId = window.setTimeout(() => {
        if (sawStreamStart || nodeCountRef.current > 0 || disposed) {
          return;
        }
        console.warn("[useGraphSocket] No graph packets received in time; temporarily showing fallback graph.");
        setStatus("error");
        setNodes(FALLBACK_NODES);
        setEdges(FALLBACK_EDGES);
        setUsingFallback(true);
        scheduleReconnect();
        try {
          ws.close();
        } catch {
          // no-op
        }
      }, GRAPH_START_TIMEOUT_MS);

      ws.onopen = () => {
        if (disposed) {
          return;
        }
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
        } catch {
          return;
        }

        if (msg.type === "start") {
          sawStreamStart = true;
          if (startTimeoutId !== null) {
            window.clearTimeout(startTimeoutId);
            startTimeoutId = null;
          }
          streamSource = msg.graphSource === "fallback" ? "fallback" : "live";
          setStatus("receiving");
          setUsingFallback(streamSource === "fallback");
          setNodes([]);
          setEdges([]);
          nodeCountRef.current = 0;
          edgeCountRef.current = 0;
          console.log("[useGraphSocket] Graph stream started", {
            expectedNodes: msg.nodeCount ?? null,
            expectedEdges: msg.edgeCount ?? null,
            source: streamSource,
          });
          return;
        }

        if (msg.type === "add_node") {
          setNodes((prev) => [...prev, msg.node]);
          nodeCountRef.current += 1;
          return;
        }

        if (msg.type === "add_edge") {
          setEdges((prev) => [...prev, msg.edge]);
          edgeCountRef.current += 1;
          return;
        }

        if (msg.type === "done") {
          setStatus("done");
          console.log("[useGraphSocket] Graph stream complete", {
            nodes: nodeCountRef.current,
            edges: edgeCountRef.current,
            source: streamSource,
          });
          relayToBackend({
            type: "graph-stream-complete",
            source: "dependency-graph-ui/useGraphSocket",
            graph_ws_url: url,
            nodes: nodeCountRef.current,
            edges: edgeCountRef.current,
            graphSource: streamSource,
          });
          if (streamSource === "fallback") {
            scheduleReconnect();
            try {
              ws.close();
            } catch {
              // no-op
            }
          }
          return;
        }

        if (msg.type === "error") {
          if (startTimeoutId !== null) {
            window.clearTimeout(startTimeoutId);
            startTimeoutId = null;
          }
          setStatus("error");
          console.error("[useGraphSocket] Backend graph stream error", msg.message ?? "unknown");
          if (nodeCountRef.current === 0) {
            setNodes(FALLBACK_NODES);
            setEdges(FALLBACK_EDGES);
            setUsingFallback(true);
          }
          scheduleReconnect();
          relayToBackend({
            type: "graph-stream-error",
            source: "dependency-graph-ui/useGraphSocket",
            graph_ws_url: url,
            message: msg.message ?? "unknown",
          });
        }
      };

      ws.onerror = () => {
        if (startTimeoutId !== null) {
          window.clearTimeout(startTimeoutId);
          startTimeoutId = null;
        }
        if (disposed) {
          return;
        }
        setStatus("error");
        console.error("[useGraphSocket] Socket transport error");
        if (nodeCountRef.current === 0) {
          setNodes(FALLBACK_NODES);
          setEdges(FALLBACK_EDGES);
          setUsingFallback(true);
        }
        scheduleReconnect();
      };

      ws.onclose = () => {
        if (startTimeoutId !== null) {
          window.clearTimeout(startTimeoutId);
          startTimeoutId = null;
        }
        if (disposed) {
          return;
        }
        setStatus("disconnected");
        console.log("[useGraphSocket] Socket closed");
        if (nodeCountRef.current === 0) {
          setNodes(FALLBACK_NODES);
          setEdges(FALLBACK_EDGES);
          setUsingFallback(true);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimers();
      if (activeSocket) {
        activeSocket.close();
      }
    };
  }, [url]);

  return { nodes, edges, status, usingFallback };
}