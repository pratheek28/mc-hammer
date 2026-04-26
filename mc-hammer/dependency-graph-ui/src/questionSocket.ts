import { useEffect, useState } from "react";

type Status = "connecting" | "connected" | "receiving" | "done" | "error" | "disconnected";

export type MCQChoice = {
  brief: string;
  overview: string;
};

export type MCQPayload = {
  choices: [MCQChoice, MCQChoice];
};

type InitialMessage = string | Record<string, unknown>;

async function fetchRemoteAndCurr(): Promise<{ remote: string; curr: string }> {
  const response = await fetch("http://127.0.0.1:8766/question-context");
  if (!response.ok) {
    throw new Error("Failed to fetch question context");
  }
  const payload = await response.json();
  return {
    remote: typeof payload?.remote === "string" ? payload.remote : "",
    curr: typeof payload?.curr === "string" ? payload.curr : "",
  };
}

async function fetchGraphForQuestion(): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const graphSocket = new WebSocket("ws://127.0.0.1:8001");

    graphSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type === "graph" && msg.graph && typeof msg.graph === "object") {
          resolve(msg.graph as Record<string, unknown>);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      } finally {
        graphSocket.close();
      }
    };

    graphSocket.onerror = () => {
      resolve(null);
      graphSocket.close();
    };
  });
}

function normalizePayload(msg: any): MCQPayload | null {
  if (!msg || typeof msg !== "object") return null;

  // Preferred shape:
  // { choices: [{ brief: "...", overview: "..." }, { brief: "...", overview: "..." }] }
  if (Array.isArray(msg.choices) && msg.choices.length >= 2) {
    const [first, second] = msg.choices;
    if (
      first &&
      second &&
      typeof first.brief === "string" &&
      typeof first.overview === "string" &&
      typeof second.brief === "string" &&
      typeof second.overview === "string"
    ) {
      return {
        choices: [
          { brief: first.brief, overview: first.overview },
          { brief: second.brief, overview: second.overview },
        ],
      };
    }
  }

  // Backward-compatible shape:
  // { choice1: "...", choice2: "...", overview1: "...", overview2: "..." }
  if (
    typeof msg.choice1 === "string" &&
    typeof msg.choice2 === "string" &&
    typeof msg.overview1 === "string" &&
    typeof msg.overview2 === "string"
  ) {
    return {
      choices: [
        { brief: msg.choice1, overview: msg.overview1 },
        { brief: msg.choice2, overview: msg.overview2 },
      ],
    };
  }

  return null;
}

export function useQuestionSocket(url: string) {
  const [question, setQuestion] = useState<MCQPayload | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  
  useEffect(() => {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setStatus("connected");
      Promise.all([fetchRemoteAndCurr(), fetchGraphForQuestion()])
        .then(([fileContext, graph]) => {
          const initialMessage: InitialMessage = {
            remote: fileContext.remote,
            curr: fileContext.curr,
            graph: graph ?? {},
          };
          ws.send(JSON.stringify(initialMessage));
        })
        .catch(() => {
          ws.send("start");
        });
    };

    ws.onmessage = (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg?.type === "start") {
        setStatus("receiving");
        setQuestion(null);
        return;
      }

      if (msg?.type === "done") {
        setStatus("done");
        return;
      }

      if (msg?.type === "error") {
        setStatus("error");
        return;
      }

      const parsed = normalizePayload(msg?.payload ?? msg);
      if (parsed) {
        setQuestion(parsed);
      }
    };

    ws.onerror = () => setStatus("error");
    ws.onclose = () => setStatus("disconnected");

    return () => ws.close();
  }, [url]);

  return { question, status };
}
