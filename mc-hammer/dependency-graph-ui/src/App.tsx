import ReactFlow, { MiniMap, Controls, Background, MarkerType } from "reactflow";
import "reactflow/dist/style.css";
import "./App.css";
import { useGraphSocket } from './useGraphSocket';
import { useCallback, useMemo } from "react";
import { sendBackendUiCommand } from "./backendCommandSocket";

export default function App() {
  const { nodes, edges, status } = useGraphSocket("ws://127.0.0.1:8000");
  const styledNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        style: {
          ...(node.style ?? {}),
          width: 190,
          borderRadius: 16,
          fontWeight: 700,
          textAlign: "center" as const,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
      })),
    [nodes]
  );
  const styledEdges = useMemo(
    () =>
      edges.map((edge) => {
        const markerEndBase = typeof edge.markerEnd === "object" && edge.markerEnd !== null ? edge.markerEnd : {};
        return {
          ...edge,
          style: {
            ...(edge.style ?? {}),
            strokeWidth: 2.8,
            stroke: "#4b5563",
          },
          markerEnd: {
            ...markerEndBase,
            type: MarkerType.ArrowClosed,
            width: 24,
            height: 24,
            color: "#4b5563",
          },
        };
      }),
    [edges]
  );

  const handleNodeClick = useCallback((_: unknown, node: { id: string; data?: { label?: unknown } }) => {
    const label = typeof node.data?.label === "string" && node.data.label.trim()
      ? node.data.label.trim()
      : node.id;

    sendBackendUiCommand<{ ok?: boolean; error?: unknown }>({
      type: "open-function",
      label,
    }).then((response) => {
      if (!response?.ok) {
        const message = typeof response?.error === "string" ? response.error : "Unknown error";
        console.error("Failed to request function open:", message);
      }
    }).catch((error) => {
      console.error("Failed to request function open:", error);
    });
  }, []);

  return (
    <div className="graph-app" style={{ width: "100vw", height: "100vh" }}>
      <div className="status-overlay" style={{ position: "absolute", top: 10, left: 10, zIndex: 10 }}>
        <span>Status: <strong>{status}</strong></span>
        <span>Nodes: {nodes.length}</span>
        <span>Edges: {edges.length}</span>
      </div>
      <ReactFlow nodes={styledNodes} edges={styledEdges} fitView onNodeClick={handleNodeClick}>
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}