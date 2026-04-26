import { useEffect, useMemo, useState } from "react";
import App from "./App";
import Question, { type ResolutionOption } from "./Question";
import { useQuestionSocket } from "./questionSocket";

const SESSION_KEY = "mc-hammer-question-confirmed";
const YES_OPTION_ID = "yes";
const AUTO_AI_OPTION_ID = "auto-ai";

function hasConfirmedInSession(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

function setConfirmedInSession(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, "true");
  } catch {
    // Ignore storage errors and keep in-memory state only.
  }
}

export default function Root() {
  const [hasConfirmed, setHasConfirmed] = useState<boolean>(() => hasConfirmedInSession());

  if (hasConfirmed) {
    return <App />;
  }

  return <GateQuestion onConfirmYes={() => {
    setConfirmedInSession();
    setHasConfirmed(true);
  }} />;
}

function GateQuestion({ onConfirmYes }: { onConfirmYes: () => void }) {
  const { question, status, sendChoice } = useQuestionSocket("ws://10.30.197.121:8050/generate-intent");
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const isWaitingOnSocket = !question && (
    status === "connecting" || status === "connected" || status === "receiving"
  );

  const options = useMemo<ResolutionOption[]>(() => {
    if (!question) {
      return [
        {
          id: YES_OPTION_ID,
          summary: "Yes, continue",
          details: "Show the dependency graph and keep it visible for the current extension session.",
        },
        {
          id: "no",
          summary: "No, not right now",
          details: "You can close this panel and reopen MC Hammer when you are ready.",
        },
        {
          id: AUTO_AI_OPTION_ID,
          summary: "Let AI do it",
          details: "Automatically choose the most suitable merge path and continue.",
        },
      ];
    }

    return [
      ...question.choices.map((choice, index) => ({
        id: `option-${index}`,
        summary: choice.brief,
        details: choice.overview,
      })),
      {
        id: AUTO_AI_OPTION_ID,
        summary: "Let AI do it",
        details: "Automatically choose the most suitable merge path and continue.",
      },
    ];
  }, [question]);

  const handleConfirm = () => {
    const selectedOption = options.find((option) => option.id === selectedOptionId);
    if (selectedOption) {
      sendChoice({
        id: selectedOption.id,
        summary: selectedOption.summary,
        details: selectedOption.details,
      });
    }
    onConfirmYes();
  };

  return (
    <div className="graph-app" style={{ width: "100vw", height: "100vh" }}>
      {isWaitingOnSocket && <GraphLoadingVisualizer />}
      <Question
        isVisible={!isWaitingOnSocket}
        question="How would you like to merge this code?"
        options={options}
        selectedOptionId={selectedOptionId}
        expandedOptionId={expandedOptionId}
        onSelectOption={setSelectedOptionId}
        onToggleMore={(optionId) =>
          setExpandedOptionId((current) => (current === optionId ? null : optionId))
        }
        onConfirm={handleConfirm}
      />
    </div>
  );
}

type LoadingNode = {
  id: number;
  x: number;
  y: number;
  depth: number;
};

type LoadingEdge = {
  from: number;
  to: number;
};

const MAX_LOADING_NODES = 42;
const NODE_GROWTH_INTERVAL_MS = 900;
const ZOOM_OUT_NODE_SPAN = 90;
const MAX_ZOOM_OUT_RATIO = 0.38;
const BRANCH_BASE_LENGTH = 18;
const BRANCH_RANDOM_LENGTH = 18;
const BRANCH_DEPTH_BOOST = 2.8;

function GraphLoadingVisualizer() {
  const [nodes, setNodes] = useState<LoadingNode[]>([{ id: 0, x: 0, y: 0, depth: 0 }]);
  const [edges, setEdges] = useState<LoadingEdge[]>([]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNodes((prevNodes) => {
        if (prevNodes.length >= MAX_LOADING_NODES) {
          return prevNodes;
        }

        const parentIndex = Math.floor(Math.random() * prevNodes.length);
        const parent = prevNodes[parentIndex];
        const angle = Math.random() * Math.PI * 2;
        const branchLength = BRANCH_BASE_LENGTH + Math.random() * BRANCH_RANDOM_LENGTH + parent.depth * BRANCH_DEPTH_BOOST;
        const childDepth = parent.depth + 1;
        const nextNode: LoadingNode = {
          id: prevNodes.length,
          x: parent.x + Math.cos(angle) * branchLength,
          y: parent.y + Math.sin(angle) * branchLength,
          depth: childDepth,
        };

        setEdges((prevEdges) => [
          ...prevEdges,
          {
            from: parent.id,
            to: nextNode.id,
          },
        ]);

        return [...prevNodes, nextNode];
      });
    }, NODE_GROWTH_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const zoomScale = useMemo(() => {
    const zoomOutProgress = Math.min(1, Math.max(0, (nodes.length - 1) / ZOOM_OUT_NODE_SPAN));
    return 1 - zoomOutProgress * MAX_ZOOM_OUT_RATIO;
  }, [nodes.length]);

  return (
    <div className="graph-loader-overlay" role="status" aria-live="polite">
      <div className="graph-loader-shell">
        <div className="graph-loader-title">Populating live grap context...</div>
        <svg viewBox="-120 -120 240 240" className="graph-loader-canvas" aria-hidden="true">
          <g
            className="graph-loader-viewport"
            style={{ transform: `translate(0px, 0px) scale(${zoomScale})` }}
          >
            {edges.map((edge) => {
              const fromNode = nodes[edge.from];
              const toNode = nodes[edge.to];
              if (!fromNode || !toNode) {
                return null;
              }
              return (
                <line
                  key={`edge-${edge.from}-${edge.to}`}
                  x1={fromNode.x}
                  y1={fromNode.y}
                  x2={toNode.x}
                  y2={toNode.y}
                  className="graph-loader-edge"
                />
              );
            })}
            {nodes.map((node, index) => (
              <circle
                key={`node-${node.id}`}
                cx={node.x}
                cy={node.y}
                r={index === 0 ? 5.3 : 4}
                className={`graph-loader-node graph-loader-node-${index % 3}`}
              />
            ))}
          </g>
          <text x={0} y={107} textAnchor="middle" className="graph-loader-caption">
            Expanding dependency map... ({nodes.length} nodes)
          </text>
        </svg>
      </div>
    </div>
  );
}
