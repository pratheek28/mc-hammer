const BACKEND_UI_COMMAND_URL = "ws://127.0.0.1:8766/ui-commands";
const BACKEND_GRAPH_RELAY_URL = "ws://127.0.0.1:8004";
const REQUEST_TIMEOUT_MS = 1500;
const GRAPH_RELAY_TIMEOUT_MS = 10 * 60 * 1000;

function requestBackend<TResponse>(
  url: string,
  payload?: Record<string, unknown>,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<TResponse> {
  return new Promise<TResponse>((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      socket.close();
      reject(new Error(`Backend websocket request timed out: ${url}`));
    }, timeoutMs);

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      callback();
      socket.close();
    };

    socket.onopen = () => {
      if (!payload) {
        return;
      }
      socket.send(JSON.stringify(payload));
    };

    socket.onmessage = (event) => {
      settle(() => {
        try {
          resolve(JSON.parse(event.data) as TResponse);
        } catch {
          reject(new Error("Invalid JSON response from backend websocket"));
        }
      });
    };

    socket.onerror = () => {
      settle(() => reject(new Error(`Backend websocket error: ${url}`)));
    };
  });
}

export function fetchQuestionContextFromBackend(): Promise<{ ok?: boolean; remote?: unknown; local?: unknown; curr?: unknown; file?: unknown }> {
  return requestBackend("ws://127.0.0.1:8002");
}

export function fetchGenerateTestsContextFromBackend(): Promise<Record<string, unknown>> {
  return requestBackend("ws://127.0.0.1:8005");
}

export function sendBackendUiCommand<TResponse = Record<string, unknown>>(command: Record<string, unknown>): Promise<TResponse> {
  return requestBackend<TResponse>(BACKEND_UI_COMMAND_URL, command);
}

export function sendGraphPayloadToBackendRelay<TResponse = Record<string, unknown>>(payload: Record<string, unknown>): Promise<TResponse> {
  return requestBackend<TResponse>(BACKEND_GRAPH_RELAY_URL, payload, GRAPH_RELAY_TIMEOUT_MS);
}
