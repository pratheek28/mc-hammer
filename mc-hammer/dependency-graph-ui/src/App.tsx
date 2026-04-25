import ReactFlow, {
  MiniMap,
  Controls,
  Background
} from "reactflow";
import "reactflow/dist/style.css";
import { useGraphSocket } from './useGraphSocket';

export default function App() {
  const { nodes, edges, status } = useGraphSocket("ws://127.0.0.1:8765");

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 10 }}>
        Status: <strong>{status}</strong> | 
        Nodes: {nodes.length} | Edges: {edges.length}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
      >
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}