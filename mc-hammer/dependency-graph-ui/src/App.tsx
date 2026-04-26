import ReactFlow, { MiniMap, Controls, Background } from "reactflow";
import "reactflow/dist/style.css";
import "./App.css";
import { useGraphSocket } from "./useGraphSocket";

export default function App() {
  const { nodes, edges, status } = useGraphSocket("ws://127.0.0.1:8000");

  return (
    <div className="graph-app" style={{ width: "100vw", height: "100vh" }}>
      <img
        className="status-chase"
        src="/chase.gif"
        alt="chase overlay"
        style={{ position: "absolute", top: 15, left: -90, zIndex: 15 }}
      />
      <div className="status-overlay" style={{ position: "absolute", top: 10, left: 10, zIndex: 10 }}>
        <span>Status: <strong>{status}</strong></span>
        <span>Nodes: {nodes.length}</span>
        <span>Edges: {edges.length}</span>
      </div>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}