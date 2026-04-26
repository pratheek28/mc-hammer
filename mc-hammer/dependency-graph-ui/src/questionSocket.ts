import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGenerateTestsContextFromBackend, fetchQuestionContextFromBackend } from "./backendCommandSocket";

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
  local: string;
  curr: string;
  file: string;
  graph: Record<string, unknown>;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchRemoteAndCurr(): Promise<{ remote: string; curr: string; file: string } | null> {
  for (let attempt = 0; attempt < INITIAL_FETCH_RETRY_LIMIT; attempt += 1) {
    try {
      const payload = await fetchQuestionContextFromBackend();
      const contextPayload = payload as Record<string, unknown>;
      if (!payload?.ok) {
        await delay(INITIAL_FETCH_RETRY_DELAY_MS);
        continue;
      }

      const remote = typeof contextPayload.remote === "string" ? contextPayload.remote : "";
      const local = typeof contextPayload.local === "string" ? contextPayload.local : "";
      const curr = typeof contextPayload.curr === "string" ? contextPayload.curr : local;
      const file = typeof contextPayload.file === "string" ? contextPayload.file : "";
      if (remote || curr || file) {
        return { remote, curr, file };
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
    local: fileContext?.curr ?? "",
    curr: fileContext?.curr ?? "",
    file: fileContext?.file ?? "",
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

function getGenerateTestsUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    parsed.pathname = "/generate-tests";
    parsed.search = "";
    parsed.hash = "";
    console.log("Derived generate-tests URL:", parsed.toString());
    return parsed.toString();
  } catch {
    console.log("Failed to parse base URL, falling back to default generate-tests URL");
    return "ws://10.30.197.121:8050/generate-tests";
  }
}

function getGenerateMergeUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    parsed.pathname = "/generate-merge";
    parsed.search = "";
    parsed.hash = "";
    console.log("Derived generate-merge URL:", parsed.toString());
    return parsed.toString();
  } catch {
    console.log("Failed to parse base URL, falling back to default generate-merge URL");
    return "ws://10.30.197.121:8050/generate-merge";
  }
}

function sendGeneratedTestsToExtension(rawPayload: unknown): void {
  const uiCommandSocket = new WebSocket("ws://127.0.0.1:8766/ui-commands");
  uiCommandSocket.onopen = () => {
    uiCommandSocket.send(
      JSON.stringify({
        type: "run-testcases",
        payload: rawPayload,
      })
    );
  };
  uiCommandSocket.onmessage = () => {
    uiCommandSocket.close();
  };
  uiCommandSocket.onerror = (error) => {
    console.error("[questionSocket] Failed to forward testcases to extension:", error);
  };
  uiCommandSocket.onclose = () => {
    // no-op
  };
}

function extractMergedFileContent(rawMessage: unknown): string | null {
  const parseIfJsonString = (value: unknown): unknown => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
      return value;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  };

  const parsed = parseIfJsonString(rawMessage);
  if (typeof parsed === "string" && parsed.trim()) {
    return parsed;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const message = parsed as Record<string, unknown>;
  const payload = parseIfJsonString(message.payload);
  const candidates: unknown[] = [
    message.file,
    message.file_content,
    message.merged_file,
    message.mergedFile,
    message.content,
    payload,
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).file : null,
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).file_content : null,
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).merged_file : null,
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).mergedFile : null,
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).content : null,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

function sendMergedCodeToExtension(mergedFileCode: string): void {
  const uiCommandSocket = new WebSocket("ws://127.0.0.1:8766/ui-commands");
  uiCommandSocket.onopen = () => {
    uiCommandSocket.send(
      JSON.stringify({
        type: "apply-merge-resolution",
        payload: {
          mergedFileCode,
          mode: "replace-function",
        },
      })
    );
  };
  uiCommandSocket.onmessage = () => {
    uiCommandSocket.close();
  };
  uiCommandSocket.onerror = (error) => {
    console.error("[questionSocket] Failed to send merged code to extension:", error);
  };
  uiCommandSocket.onclose = () => {
    // no-op
  };
}

function openGenerateMergeSocket(baseUrl: string): void {
  const generateMergeSocket = new WebSocket(getGenerateMergeUrl(baseUrl));
  let mergeResolved = false;

  generateMergeSocket.onmessage = (event) => {
    console.log("[questionSocket] Received generate-merge payload:", event.data);
    let parsedMessage: unknown = event.data;
    if (typeof event.data === "string") {
      try {
        parsedMessage = JSON.parse(event.data);
      } catch {
        // Keep original string payload as-is.
      }
    }

    const messageRecord =
      parsedMessage && typeof parsedMessage === "object"
        ? (parsedMessage as Record<string, unknown>)
        : null;
    const messageType = typeof messageRecord?.type === "string" ? messageRecord.type : "";
    if (messageType === "error") {
      console.error("[questionSocket] generate-merge backend returned error:", parsedMessage);
      generateMergeSocket.close();
      return;
    }

    const mergedFileCode = extractMergedFileContent(parsedMessage);
    if (mergedFileCode) {
      mergeResolved = true;
      window.alert("Merge conflict has been resolved.");
      const shouldApply = window.confirm(
        "Apply the generated merge resolution? This will replace the target function with the fixed code."
      );
      if (shouldApply) {
        sendMergedCodeToExtension(mergedFileCode);
      }
      generateMergeSocket.close();
      return;
    }

    if (messageType === "done") {
      generateMergeSocket.close();
    }
  };

  generateMergeSocket.onerror = (error) => {
    console.error("[questionSocket] generate-merge websocket error:", error);
  };

  generateMergeSocket.onclose = () => {
    if (!mergeResolved) {
      console.log("[questionSocket] generate-merge socket closed without merge payload");
    }
  };
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
      console.log("[questionSocket] raw websocket payload:", event.data);
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

    const userSelection = [choice.summary, choice.details]
      .filter((part) => typeof part === "string" && part.length > 0)
      .join("\n\n");
    void fetchGenerateTestsContextFromBackend()
      .then((backendContext) => {
        const generateTestsPayload = {
          ...backendContext,
          user_selection: userSelection,
          selection: userSelection,
          intent: userSelection,
        };
        const generateTestsSocket = new WebSocket(getGenerateTestsUrl(url));
        generateTestsSocket.onopen = () => {
          generateTestsSocket.send(JSON.stringify(generateTestsPayload));
        };
        generateTestsSocket.onmessage = (event) => {
          console.log("[questionSocket] Received generate-tests payload:", event.data);
          let parsedMessage: any = event.data;
          if (typeof event.data === "string") {
            try {
              parsedMessage = JSON.parse(event.data);
            } catch {
              // Keep original string payload for extension-side parsing fallback.
            }
          }

          const messageType = typeof parsedMessage?.type === "string" ? parsedMessage.type : "";
          if (messageType === "error") {
            console.error("[questionSocket] generate-tests backend returned error:", parsedMessage);
            generateTestsSocket.close();
            return;
          }

          if (messageType === "done") {
            generateTestsSocket.close();
            return;
          }

          sendGeneratedTestsToExtension(parsedMessage?.payload ?? parsedMessage);
        };
        generateTestsSocket.onerror = (error) => {
          console.error("[questionSocket] generate-tests websocket error:", error);
        };
        generateTestsSocket.onclose = () => {
          console.log("[questionSocket] generate-tests socket closed");
          openGenerateMergeSocket(url);
        };
      })
      .catch((error) => {
        console.error("[questionSocket] Failed to fetch generate-tests context from backend:", error);
      });
  }, []);

  return { question, status, sendChoice };
}
