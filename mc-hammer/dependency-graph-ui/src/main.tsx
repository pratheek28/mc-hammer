import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "./index.css";
import "./App.css";
import App from "./App";
import Question, { type ResolutionOption } from "./Question";

// optional way of implementation:
type BackendOptionsMessage = {
  type: "resolution_options";
  question?: string;
  options?: ResolutionOption[];
};

const DEFAULT_QUESTION =
  "We have assessed this merge conflict and found 3 optimal solutions. Which solution do you prefer us to implement?";
const UI_SOCKET_URL = "ws://127.0.0.1:8765";

const DEV_MOCK_MODE = false;
// DELETE: temporary fake payload for UI testing.
const DEV_MOCK_MESSAGE: BackendOptionsMessage = {
  type: "resolution_options",
  question: DEFAULT_QUESTION,
  options: [
    {
      id: "opt-1",
      summary: "Keep incoming branch logic",
      details: "Uses the newer implementation and minimizes future maintenance effort.",
    },
    {
      id: "opt-2",
      summary: "Keep current branch logic",
      details: "Safer short term because behavior remains consistent with current production.",
    },
    {
      id: "opt-3",
      summary: "Hybrid merge of both solutions",
      details: "Combines compatibility from current logic with validation improvements from incoming.",
    },
  ],
};

function RootFlow() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [options, setOptions] = useState<ResolutionOption[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const [showQuestion, setShowQuestion] = useState(false);
  const [uiSocket, setUiSocket] = useState<WebSocket | null>(null);

  const applyResolutionOptions = (msg: BackendOptionsMessage) => {
    const nextOptions = (msg.options ?? []).slice(0, 3);
    if (nextOptions.length === 0) {
      return;
    }

    setQuestion(msg.question ?? DEFAULT_QUESTION);
    setOptions(nextOptions);
    setSelectedOptionId(null);
    setExpandedOptionId(null);
    setShowQuestion(true);
  };

  useEffect(() => {
    if (DEV_MOCK_MODE) {
      applyResolutionOptions(DEV_MOCK_MESSAGE);
      return;
    }

    const socket = new WebSocket(UI_SOCKET_URL);
    setUiSocket(socket);

    socket.onmessage = (event) => {
      let msg: BackendOptionsMessage | null = null;
      try {
        msg = JSON.parse(event.data) as BackendOptionsMessage;
      } catch {
        return;
      }

      if (msg.type !== "resolution_options") {
        return;
      }

      applyResolutionOptions(msg);
    };

    return () => socket.close();
  }, []);

  const handleConfirm = () => {
    if (!selectedOptionId) {
      return;
    }

    if (uiSocket && uiSocket.readyState === WebSocket.OPEN) {
      uiSocket.send(
        JSON.stringify({
          type: "sendToBackend",
          selectedOptionId,
        })
      );
    }
    setExpandedOptionId(null);
    setShowQuestion(false);
  };

  return (
    <>
      <App />
      {showQuestion && (
        <Question
          question={question}
          options={options}
          selectedOptionId={selectedOptionId}
          expandedOptionId={expandedOptionId}
          onSelectOption={setSelectedOptionId}
          onToggleMore={(optionId) => setExpandedOptionId((prev) => (prev === optionId ? null : optionId))}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<RootFlow />);
