import { createRoot } from "react-dom/client";
import { useState } from "react";
import "./index.css";
import "./App.css";
import App from "./App";
import Question, { type ResolutionOption } from "./Question";

const DEFAULT_QUESTION =
  "We have assessed this merge conflict and found 3 optimal solutions. Which solution do you prefer us to implement?";

export function RootFlow() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [options, setOptions] = useState<ResolutionOption[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const [showQuestion, setShowQuestion] = useState(false);

  // Socket-only logic goes here when the Question page should appear.
  // Example:
  // useEffect(() => {
  //   const socket = new WebSocket("ws://127.0.0.1:8765");
  //   socket.onmessage = (event: MessageEvent) => {
  //     const msg = JSON.parse(event.data as string) as BackendOptionsMessage;
  //     if (msg.type !== "resolution_options") {
  //       return;
  //     }
  //     setQuestion(msg.question ?? DEFAULT_QUESTION);
  //     setOptions((msg.options ?? []).slice(0, 3));
  //     setSelectedOptionId(null);
  //     setExpandedOptionId(null);
  //     setShowQuestion(true);
  //   };
  //   return () => socket.close();
  // }, []);

  const handleConfirm = () => {
    // Socket send logic would go here for sending back user's choice made.
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