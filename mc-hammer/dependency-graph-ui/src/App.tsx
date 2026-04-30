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
const TREE_LAYER_GAP_Y = 170;
const TREE_NODE_GAP_X = 250;
const TREE_BASE_X = 90;
const TREE_BASE_Y = 90;
const TARGET_MERGE_FILE_PATH = "/Users/pranavgowrish/Downloads/temp/scrapy/scrapy/utils/python.py";
const TARGET_MERGE_FUNCTION_NAME = "to_unicode";
const TARGET_MERGE_FUNCTION_CODE = `def to_unicode(
    text: str | bytes, encoding: str | None = None, errors: str = "strict"
) -> str:
    """Return the unicode representation of a bytes object \`\`text\`\`. If
    \`\`text\`\` is already an unicode object, return it as-is."""
    if isinstance(text, str):
        return text
    if not isinstance(text, (bytes, str)):
        raise TypeError(
            f"to_unicode must receive a bytes or str object, got {type(text).__name__}"
        )
    if encoding is None:
        encoding = "utf-8"
    return text.decode(encoding, errors)
`;

function parseNodeId(nodeId: string): { filePath: string; functionName: string; line: number } | null {
  // Backend format: "<absolute_file_path>:<function_name>:<lineno>"
  // Use lastIndexOf twice so paths containing colons (e.g. Windows "C:\...") still parse correctly.
  const lastColon = nodeId.lastIndexOf(":");
  if (lastColon < 0) {
    return null;
  }
  const lineNumber = Number(nodeId.slice(lastColon + 1));
  if (!Number.isFinite(lineNumber) || lineNumber <= 0) {
    return null;
  }
  const beforeLine = nodeId.slice(0, lastColon);
  const secondLastColon = beforeLine.lastIndexOf(":");
  if (secondLastColon < 0) {
    return null;
  }
  const functionName = beforeLine.slice(secondLastColon + 1);
  const filePath = beforeLine.slice(0, secondLastColon);
  if (!filePath || !functionName) {
    return null;
  }
  return { filePath, functionName, line: lineNumber };
}

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

function buildTreePositions(
  nodeIds: string[],
  rawEdges: Array<{ source: string; target: string }>
): Record<string, { x: number; y: number }> {
  if (nodeIds.length === 0) {
    return {};
  }

  const outgoingBySource = new Map<string, string[]>();
  const incomingCountByNode = new Map<string, number>();
  for (const nodeId of nodeIds) {
    incomingCountByNode.set(nodeId, 0);
  }

  for (const edge of rawEdges) {
    const outgoing = outgoingBySource.get(edge.source) ?? [];
    outgoing.push(edge.target);
    outgoingBySource.set(edge.source, outgoing);
    incomingCountByNode.set(edge.target, (incomingCountByNode.get(edge.target) ?? 0) + 1);
  }

  const roots = nodeIds.filter((nodeId) => (incomingCountByNode.get(nodeId) ?? 0) === 0);
  const queue = roots.length > 0 ? [...roots] : [nodeIds[0]];
  const depthByNode = new Map<string, number>();
  const visitOrder: string[] = [];

  for (const root of queue) {
    depthByNode.set(root, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    visitOrder.push(current);
    const currentDepth = depthByNode.get(current) ?? 0;
    const children = outgoingBySource.get(current) ?? [];
    for (const child of children) {
      if (!depthByNode.has(child) || (depthByNode.get(child) ?? 0) > currentDepth + 1) {
        depthByNode.set(child, currentDepth + 1);
      }
      if (!queue.includes(child)) {
        queue.push(child);
      }
    }
  }

  for (const nodeId of nodeIds) {
    if (!depthByNode.has(nodeId)) {
      depthByNode.set(nodeId, 0);
      visitOrder.push(nodeId);
    }
  }

  const byDepth = new Map<number, string[]>();
  for (const nodeId of visitOrder) {
    const depth = depthByNode.get(nodeId) ?? 0;
    const layer = byDepth.get(depth) ?? [];
    if (!layer.includes(nodeId)) {
      layer.push(nodeId);
      byDepth.set(depth, layer);
    }
  }

  const positions: Record<string, { x: number; y: number }> = {};
  const orderedDepths = [...byDepth.keys()].sort((a, b) => a - b);
  const maxDepth = orderedDepths.length > 0 ? orderedDepths[orderedDepths.length - 1] : 0;
  for (const depth of orderedDepths) {
    const layerNodes = byDepth.get(depth) ?? [];
    const width = (layerNodes.length - 1) * TREE_NODE_GAP_X;
    const startX = TREE_BASE_X - width / 2;
    // Flip vertically so deeper nodes render toward the top.
    const flippedDepth = maxDepth - depth;
    const y = TREE_BASE_Y + flippedDepth * TREE_LAYER_GAP_Y;
    layerNodes.forEach((nodeId, index) => {
      positions[nodeId] = {
        x: startX + index * TREE_NODE_GAP_X,
        y,
      };
    });
  }

  return positions;
}

export default function App() {
  const { nodes, edges, status, usingFallback } = useGraphSocket("ws://127.0.0.1:8000");
  const [nodeOutcomes, setNodeOutcomes] = useState<Record<string, NodeOutcome>>({});
  const [ballStates, setBallStates] = useState<BallState[]>([]);
  const [activeRun, setActiveRun] = useState<1 | 2 | null>(null);
  const [testsReceived, setTestsReceived] = useState(false);
  const mergePromptedRef = useRef(false);
  const testsReceivedRef = useRef(false);

  const traversalPath = useMemo(
    () => buildTraversalPath(
      nodes.map((node) => node.id),
      edges.map((edge) => ({ source: String(edge.source), target: String(edge.target) }))
    ),
    [nodes, edges]
  );
  const treePositions = useMemo(
    () =>
      buildTreePositions(
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
    if (!testsReceived || mergePromptedRef.current) {
      return;
    }
    mergePromptedRef.current = true;
    const shouldMerge = window.confirm(
      "Testcases completed. Confirm merge now into scrapy/utils/python.py?"
    );
    if (!shouldMerge) {
      return;
    }
    void sendBackendUiCommand<{ ok?: boolean; error?: unknown }>({
      type: "apply-merge-resolution",
      payload: {
        mergedFileCode: "hardcoded-function-replacement",
        mode: "replace-function",
        targetFilePath: TARGET_MERGE_FILE_PATH,
        functionName: TARGET_MERGE_FUNCTION_NAME,
        replacementFunction: TARGET_MERGE_FUNCTION_CODE,
      },
    }).then((response) => {
      if (!response?.ok) {
        const message = typeof response?.error === "string" ? response.error : "Unknown error";
        window.alert(`Failed to apply merge: ${message}`);
        return;
      }
      window.alert("Merge applied successfully.");
    }).catch((error) => {
      window.alert(`Failed to apply merge: ${String(error)}`);
    });
  }, [testsReceived]);

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

        if (testsReceivedRef.current || run === 2) {
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

      if (run === 2) {
        setNodeOutcomes(
          traversalPath.reduce<Record<string, NodeOutcome>>((acc, nodeId) => {
            acc[nodeId] = "pass";
            return acc;
          }, {})
        );
        setBallStates((prev) => prev.map((ball) => ({ ...ball, isFailing: false })));
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
      nodes.map((node) => {
        const rawLabel = typeof node.data?.label === "string" ? node.data.label : node.id;
        return ({
        ...node,
        position: treePositions[node.id] ?? node.position,
        className: nodeOutcomes[node.id] === "pass"
          ? "test-node-pass"
          : nodeOutcomes[node.id] === "fail"
            ? "test-node-fail"
            : "test-node-neutral",
        data: {
          ...node.data,
          functionName: rawLabel,
          label: (
            <div className="test-node-label">
              <span>{rawLabel}</span>
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
      });
      }),
    [nodes, nodeOutcomes, ballStates, activeRun, treePositions]
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

  const handleNodeClick = useCallback((_: unknown, node: { id: string; data?: { functionName?: unknown; label?: unknown } }) => {
    const parsed = parseNodeId(node.id);
    const fromData = typeof node.data?.functionName === "string" && node.data.functionName.trim()
      ? node.data.functionName.trim()
      : null;
    const label = fromData ?? parsed?.functionName ?? node.id;

    sendBackendUiCommand<{ ok?: boolean; error?: unknown }>({
      type: "open-function",
      label,
      filePath: parsed?.filePath ?? null,
      line: parsed?.line ?? null,
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
        <span>Graph: {usingFallback ? "fallback" : "live"}</span>
      </div>
      <ReactFlow nodes={styledNodes} edges={styledEdges} fitView onNodeClick={handleNodeClick}>
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}