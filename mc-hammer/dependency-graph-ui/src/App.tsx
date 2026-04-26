import ReactFlow, { MiniMap, Controls, Background, MarkerType } from "reactflow";
import "reactflow/dist/style.css";
import "./App.css";
import { useGraphSocket } from './useGraphSocket';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendBackendUiCommand } from "./backendCommandSocket";

type NodeOutcome = "neutral" | "pass" | "fail";
type BallState = {
  id: string;
  nodeId: string | null;
  isFailing: boolean;
};

const TESTCASE_COUNT = 5;
const STEP_MS = 680;
const RUN_RESET_DELAY_MS = 1100;
const TESTCASE_EVENT = "mc-hammer:testcases-received";

function buildTraversalPath(nodeIds: string[], rawEdges: Array<{ source: string; target: string }>): string[] {
  if (nodeIds.length === 0) {
    return [];
  }

  const outgoingBySource = new Map<string, string[]>();
  for (const edge of rawEdges) {
    const list = outgoingBySource.get(edge.source) ?? [];
    list.push(edge.target);
    outgoingBySource.set(edge.source, list);
  }

  const path: string[] = [];
  const visited = new Set<string>();
  let current = nodeIds[0];
  while (current && !visited.has(current)) {
    path.push(current);
    visited.add(current);
    const nextCandidates = outgoingBySource.get(current) ?? [];
    const next = nextCandidates.find((candidate) => !visited.has(candidate)) ?? null;
    if (!next) {
      break;
    }
    current = next;
  }

  if (path.length < nodeIds.length) {
    for (const nodeId of nodeIds) {
      if (!visited.has(nodeId)) {
        path.push(nodeId);
      }
    }
  }

  return path;
}

export default function App() {
  const { nodes, edges, status } = useGraphSocket("ws://127.0.0.1:8000");
  const [nodeOutcomes, setNodeOutcomes] = useState<Record<string, NodeOutcome>>({});
  const [ballStates, setBallStates] = useState<BallState[]>([]);
  const [activeRun, setActiveRun] = useState<1 | 2 | null>(null);
  const [testsReceived, setTestsReceived] = useState(false);
  const testsReceivedRef = useRef(false);

  const traversalPath = useMemo(
    () => buildTraversalPath(
      nodes.map((node) => node.id),
      edges.map((edge) => ({ source: String(edge.source), target: String(edge.target) }))
    ),
    [nodes, edges]
  );

  useEffect(() => {
    const onTestsReceived = () => {
      testsReceivedRef.current = true;
      setTestsReceived(true);
    };
    window.addEventListener(TESTCASE_EVENT, onTestsReceived);
    return () => {
      window.removeEventListener(TESTCASE_EVENT, onTestsReceived);
    };
  }, []);

  useEffect(() => {
    if (status !== "done" || traversalPath.length === 0) {
      return;
    }

    const firstRunFailingCaseIds = new Set(["tc-2", "tc-4"]);
    let cancelled = false;

    const createEmptyOutcomes = () =>
      traversalPath.reduce<Record<string, NodeOutcome>>((acc, nodeId) => {
        acc[nodeId] = "neutral";
        return acc;
      }, {});

    const runSuiteAnimation = async (run: 1 | 2) => {
      const finalPathIndex = traversalPath.length - 1;
      const failingCases = new Set(
        run === 1
          ? ["tc-2", "tc-4"]
          : []
      );
      const progressByBall = Array.from({ length: TESTCASE_COUNT }, () => 0);
      const isBallDone = Array.from({ length: TESTCASE_COUNT }, () => false);

      setActiveRun(run);
      setNodeOutcomes(createEmptyOutcomes());
      setBallStates(
        Array.from({ length: TESTCASE_COUNT }, (_, index) => ({
          id: `tc-${index + 1}`,
          nodeId: traversalPath[0] ?? null,
          isFailing: run === 1 && firstRunFailingCaseIds.has(`tc-${index + 1}`),
        }))
      );

      await new Promise((resolve) => window.setTimeout(resolve, STEP_MS));
      if (cancelled) {
        return;
      }

      let tick = 0;
      while (isBallDone.some((done) => !done)) {
        const movingBallIndex = tick % TESTCASE_COUNT;
        const testcaseId = `tc-${movingBallIndex + 1}`;
        const currentProgress = progressByBall[movingBallIndex];
        const nextProgress = Math.min(currentProgress + 1, finalPathIndex);
        progressByBall[movingBallIndex] = nextProgress;
        if (nextProgress >= finalPathIndex) {
          isBallDone[movingBallIndex] = true;
        }

        setBallStates(
          progressByBall.map((progress, index) => ({
            id: `tc-${index + 1}`,
            nodeId: traversalPath[Math.min(progress, finalPathIndex)] ?? null,
            isFailing: run === 1 && failingCases.has(`tc-${index + 1}`),
          }))
        );

        if (testsReceivedRef.current) {
          const currentNodeId = traversalPath[nextProgress];
          const didFailHere = run === 1 && failingCases.has(testcaseId) && nextProgress >= finalPathIndex;
          setNodeOutcomes((prev) => {
            const next = { ...prev };
            const previous = next[currentNodeId];
            if (didFailHere) {
              next[currentNodeId] = "fail";
            } else if (previous !== "fail") {
              next[currentNodeId] = "pass";
            }
            return next;
          });
        }

        tick += 1;
        await new Promise((resolve) => window.setTimeout(resolve, STEP_MS));
        if (cancelled) {
          return;
        }
      }
    };

    void (async () => {
      await runSuiteAnimation(1);
      if (cancelled) {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, RUN_RESET_DELAY_MS));
      if (cancelled) {
        return;
      }
      await runSuiteAnimation(2);
    })();

    return () => {
      cancelled = true;
    };
  }, [status, traversalPath]);

  const styledNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        className: nodeOutcomes[node.id] === "pass"
          ? "test-node-pass"
          : nodeOutcomes[node.id] === "fail"
            ? "test-node-fail"
            : "test-node-neutral",
        data: {
          ...node.data,
          label: (
            <div className="test-node-label">
              <span>{typeof node.data?.label === "string" ? node.data.label : node.id}</span>
              <div className="test-balls">
                {ballStates
                  .filter((ball) => ball.nodeId === node.id)
                  .map((ball) => (
                    <span
                      key={ball.id}
                      title={ball.id}
                      className={`test-ball ${ball.isFailing && activeRun === 1 ? "test-ball-fail" : "test-ball-pass"}`}
                    />
                  ))}
              </div>
            </div>
          ),
        },
        style: {
          ...(node.style ?? {}),
          width: 190,
          borderRadius: 16,
          fontWeight: 700,
          textAlign: "center" as const,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2,
          borderStyle: "solid",
        },
      })),
    [nodes, nodeOutcomes, ballStates, activeRun]
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
        <span>Run: {activeRun ?? "-"}</span>
        <span>Tests: {testsReceived ? "received" : "waiting"}</span>
      </div>
      <ReactFlow nodes={styledNodes} edges={styledEdges} fitView onNodeClick={handleNodeClick}>
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}