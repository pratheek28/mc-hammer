import { useMemo, useState } from "react";
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
  const { question, sendChoice } = useQuestionSocket("ws://10.30.197.121:8000/generate-intent");
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);

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
      <Question
        isVisible
        question="Do you want to open the dependency graph?"
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
