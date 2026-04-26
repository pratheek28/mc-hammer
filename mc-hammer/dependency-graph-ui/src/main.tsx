import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "./index.css";
import "./App.css";
import App from "./App";
import Question, { type ResolutionOption } from "./Question";

type BackendOptionsMessage = {
  type: "resolution_options";
  question?: string;
  options?: ResolutionOption[];
};

const DEFAULT_QUESTION =
  "We have assessed this merge conflict and found 3 optimal solutions. Which solution do you prefer us to implement?";
const UI_SOCKET_URL = "ws://127.0.0.1:8765";

function RootFlow() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [options, setOptions] = useState<ResolutionOption[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const [showQuestion, setShowQuestion] = useState(false);
  const [uiSocket, setUiSocket] = useState<WebSocket | null>(null);

  useEffect(() => {
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

    return () => socket.close();
  }, []);

  const handleConfirm = () => {
    if (!selectedOptionId || !uiSocket || uiSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    uiSocket.send(
      JSON.stringify({
        type: "sendToBackend",
        selectedOptionId,
      })
    );
    setExpandedOptionId(null);
    setShowQuestion(false);
  };

  if (showQuestion) {
    return (
      <Question
        question={question}
        options={options}
        selectedOptionId={selectedOptionId}
        expandedOptionId={expandedOptionId}
        onSelectOption={setSelectedOptionId}
        onToggleMore={(optionId) => setExpandedOptionId((prev) => (prev === optionId ? null : optionId))}
        onConfirm={handleConfirm}
      />
    );
  }

  return <App />;
}

createRoot(document.getElementById("root")!).render(<RootFlow />);
