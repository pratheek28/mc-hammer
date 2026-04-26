import { useCallback, useEffect, useRef, useState } from "react";
import { fetchQuestionContextFromBackend } from "./backendCommandSocket";

type Status = "connecting" | "connected" | "receiving" | "done" | "error" | "disconnected";
const INITIAL_FETCH_RETRY_LIMIT = 10;
const INITIAL_FETCH_RETRY_DELAY_MS = 300;

export type MCQChoice = {
  brief: string;
  overview: string;
};

export type MCQPayload = {
  choices: [MCQChoice, MCQChoice];
};

type Solution = {
  title: string;
  detail: string;
};

type InitialMessage = {
  remote: string;
  curr: string;
  graph: Record<string, unknown>;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchRemoteAndCurr(): Promise<{ remote: string; curr: string } | null> {
  for (let attempt = 0; attempt < INITIAL_FETCH_RETRY_LIMIT; attempt += 1) {
    try {
      const payload = await fetchQuestionContextFromBackend();
      if (!payload?.ok) {
        await delay(INITIAL_FETCH_RETRY_DELAY_MS);
        continue;
      }

      const remote = typeof payload?.remote === "string" ? payload.remote : "";
      const curr = typeof payload?.curr === "string" ? payload.curr : "";
      if (remote || curr) {
        return { remote, curr };
      }
    } catch {
      // Retry below.
    }
    await delay(INITIAL_FETCH_RETRY_DELAY_MS);
  }

  return null;
}

async function fetchGraphForQuestionOnce(): Promise<Record<string, unknown> | null> {
  try {
    return await new Promise((resolve) => {
      const graphSocket = new WebSocket("ws://127.0.0.1:8001");
      const timeoutId = window.setTimeout(() => {
        resolve(null);
        graphSocket.close();
      }, 1200);
      const resolveOnce = (value: Record<string, unknown> | null) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      };

      graphSocket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg?.type === "graph" && msg.graph && typeof msg.graph === "object") {
            resolveOnce(msg.graph as Record<string, unknown>);
          } else {
            resolveOnce(null);
          }
        } catch {
          resolveOnce(null);
        } finally {
          graphSocket.close();
        }
      };

      graphSocket.onerror = () => {
        resolveOnce(null);
        graphSocket.close();
      };
    });
  } catch {
    return null;
  }
}

async function fetchGraphForQuestion(): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < INITIAL_FETCH_RETRY_LIMIT; attempt += 1) {
    const graph = await fetchGraphForQuestionOnce();
    if (graph && Object.keys(graph).length > 0) {
      return graph;
    }
    await delay(INITIAL_FETCH_RETRY_DELAY_MS);
  }

  return null;
}

function isSocketOpen(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN;
}

function sendIfOpen(socket: WebSocket, payload: string): boolean {
  if (!isSocketOpen(socket)) {
    return false;
  }
  socket.send(payload);
  return true;
}

async function buildInitialMessage(): Promise<InitialMessage> {
  const [fileContextResult, graphResult] = await Promise.allSettled([
    fetchRemoteAndCurr(),
    fetchGraphForQuestion(),
  ]);
  const fileContext = fileContextResult.status === "fulfilled" ? fileContextResult.value : null;
  const graph = graphResult.status === "fulfilled" ? graphResult.value : null;

  return {
    remote: fileContext?.remote ?? "",
    curr: fileContext?.curr ?? "",
    graph: graph ?? {},
  };
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

  // Model output shape from gain_understanding_of_project_return_viable_solutions:
  // { solutions: [{ title: "...", detail: "..." }, { title: "...", detail: "..." }] }
  const solutionCandidates = Array.isArray(msg.solutions)
    ? msg.solutions
    : Array.isArray(msg?.payload?.solutions)
      ? msg.payload.solutions
      : Array.isArray(msg?.upstream?.solutions)
        ? msg.upstream.solutions
        : null;

  if (solutionCandidates && solutionCandidates.length >= 2) {
    const [first, second] = solutionCandidates as [Solution, Solution];
    if (
      first &&
      second &&
      typeof first.title === "string" &&
      typeof first.detail === "string" &&
      typeof second.title === "string" &&
      typeof second.detail === "string"
    ) {
      return {
        choices: [
          { brief: first.title, overview: first.detail },
          { brief: second.title, overview: second.detail },
        ],
      };
    }
  }

  // Some upstream responses can be wrapped as a raw JSON string.
  if (typeof msg.raw_response === "string") {
    try {
      const parsedRaw = JSON.parse(msg.raw_response);
      return normalizePayload(parsedRaw);
    } catch {
      return null;
    }
  }

  return null;
}

export function useQuestionSocket(url: string) {
  const [question, setQuestion] = useState<MCQPayload | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  
  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      console.log("Connected to question socket");
      void buildInitialMessage().then((initialMessage) => {
        sendIfOpen(ws, JSON.stringify(initialMessage));
      });
    };

    ws.onmessage = (event) => {
      console.log("Received message from question socket");
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
        setStatus("done");
      }
    };

    ws.onerror = () => setStatus("error");
    ws.onclose = () => setStatus("disconnected");

    return () => {
      wsRef.current = null;
      ws.close();
    };
  }, [url]);

  const sendChoice = useCallback((choice: { id?: string; summary?: string; details?: string } | string) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (typeof choice === "string") {
      socket.send(choice);
      return;
    }

    socket.send(
      JSON.stringify({
        type: "choice",
        payload: choice,
      })
    );
  }, []);

  return { question, status, sendChoice };
}
