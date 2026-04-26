import { useEffect, useMemo, useState } from "react";
import App from "./App";
import Question, { type ResolutionOption } from "./Question";
import { useQuestionSocket } from "./questionSocket";

const SESSION_KEY = "mc-hammer-question-confirmed";
const YES_OPTION_ID = "yes";

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
      ];
    }

    return question.choices.map((choice, index) => ({
      id: `option-${index}`,
      summary: choice.brief,
      details: choice.overview,
    }));
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
    const selectedSummary = selectedOption?.summary.trim().toLowerCase() ?? "";
    const isYes = selectedOptionId === YES_OPTION_ID || selectedSummary.startsWith("yes");
    if (isYes) {
      onConfirmYes();
    }
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
};

function GraphLoadingVisualizer() {
  const [tick, setTick] = useState(0);
  const nodes = useMemo<LoadingNode[]>(() => {
    const nodeCount = Math.min(14, Math.max(2, Math.floor(tick / 4) + 2));
    const centerX = 50;
    const centerY = 50;
    const radius = 35;
    return Array.from({ length: nodeCount }, (_, index) => {
      const angle = ((Math.PI * 2) / nodeCount) * index + tick * 0.015;
      const wobble = Math.sin((tick + index * 7) * 0.14) * 4;
      return {
        id: index,
        x: centerX + Math.cos(angle) * (radius + wobble),
        y: centerY + Math.sin(angle) * (radius + wobble),
      };
    });
  }, [tick]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTick((prev) => prev + 1);
    }, 140);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="graph-loader-overlay" role="status" aria-live="polite">
      <div className="graph-loader-shell">
        <div className="graph-loader-title">Building live graph context...</div>
        <svg viewBox="0 0 100 100" className="graph-loader-canvas" aria-hidden="true">
          {nodes.map((fromNode, index) => {
            const toNode = nodes[(index + 1) % nodes.length];
            return (
              <line
                key={`edge-${fromNode.id}-${toNode.id}`}
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
              r={index === 0 ? 3.4 : 2.8}
              className={`graph-loader-node graph-loader-node-${index % 3}`}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
