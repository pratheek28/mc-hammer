import asyncio
import websockets
from websockets.sync.client import connect
from collections import deque
from pathlib import Path
import json
import networkx as nx
import math

try:
    from dependency_graph_file_getter_helper import get_all_files, extract_functions, get_project_root
except ImportError:
    # Supports importing as backend.web_sockets_server
    from backend.dependency_graph_file_getter_helper import get_all_files, extract_functions, get_project_root

FUNCTION_INDEX: dict[str, tuple[object, str]] = {}
graph_queue: asyncio.Queue = asyncio.Queue()
MAX_AMBIGUOUS_CALLEE_LINKS = 8
LATEST_COMMIT_MESSAGE = ""
LATEST_REMOTE_CONTENT = ""
LATEST_CURRENT_CONTENT = ""


def _parse_conflicted_functions(value) -> dict[str, list[str]]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except (TypeError, ValueError, json.JSONDecodeError):
            return {}
    return {}


def build_dependency_graph(root: Path):
    G = nx.DiGraph()
    fn_dict = {}
    fn_name_to_ids: dict[str, list[str]] = {}
    dir_queue = deque([root])
    file_queue = deque()
    get_all_files(root, dir_queue, file_queue)

    while file_queue:
        current = file_queue.popleft()
        functions = extract_functions(current)
        for fn in functions:
            fn_id = f"{current}:{fn.name}:{fn.lineno}"
            fn_dict[fn_id] = fn
            FUNCTION_INDEX[fn_id] = (fn, str(current))
            fn_name_to_ids.setdefault(fn.name, []).append(fn_id)

    for fn_id, fn in fn_dict.items():
        G.add_node(fn_id, label=fn.name)
        for call in fn.calls:
            # Normalize "self.make_response" -> "make_response" so method calls connect.
            call_name = call.split(".")[-1]
            candidates = fn_name_to_ids.get(call_name, [])
            if len(candidates) == 1:
                G.add_edge(fn_id, candidates[0])
                continue

            if len(candidates) > 1:
                # Prefer same-file target when ambiguous (common for self.<method>()).
                caller_file = str(fn_id).split(":", 1)[0]
                same_file = [cand for cand in candidates if str(cand).split(":", 1)[0] == caller_file]
                if len(same_file) == 1:
                    G.add_edge(fn_id, same_file[0])
                    continue

                # Fallback: keep graph connected in large repos where names repeat.
                # Capped fan-out avoids pathological edge explosion.
                for cand in candidates[:MAX_AMBIGUOUS_CALLEE_LINKS]:
                    G.add_edge(fn_id, cand)
    return G

def get_function_source_from_file(
    function_name: str,
    file_path: str,
    lineno_hint: int | None = None,
) -> str | None:
    try:
        functions = extract_functions(file_path)
    except Exception as e:
        print(f"[generate-tests] Failed to parse {file_path}: {e}")
        return None

    if lineno_hint is not None:
        for fn in functions:
            if fn.name == function_name and fn.lineno == lineno_hint:
                return fn.source

    for fn in functions:
        if fn.name == function_name:
            return fn.source

    return None

def format_function_context(function_name: str, file_path: str, function_source: str) -> str:
    return (
        f"file_name: {file_path}\n"
        f"function_name: {function_name}\n"
        "function_content:\n"
        f"{function_source}"
    )

def send_generate_tests_request(
    node: str,
    ancestors: set[str],
):
    node_info = FUNCTION_INDEX.get(node)
    if node_info is None:
        print(f"[generate-tests] Node not found in index: {node}")
        return

    node_fn, node_file_path = node_info

    try:
        with open(node_file_path, "r", encoding="utf-8") as f:
            raw_file_content = f.read()
    except OSError as e:
        print(f"[generate-tests] Failed to read file {node_file_path}: {e}")
        return

    file_content = (
        f"file_name: {node_file_path}\n"
        "file_content:\n"
        f"{raw_file_content}"
    )

    readme_content = ""
    readme_path = get_project_root() / "README.md"
    try:
        with open(readme_path, "r", encoding="utf-8") as f:
            readme_content = (
                f"file_name: {readme_path}\n"
                "file_content:\n"
                f"{f.read()}"
            )
    except OSError as e:
        print(f"[generate-tests] Failed to read README at {readme_path}: {e}")

    # Pull source from actual file line ranges at request-time.
    node_source = get_function_source_from_file(node_fn.name, node_file_path, node_fn.lineno) or node_fn.source
    conflict_functions = [format_function_context(node_fn.name, node_file_path, node_source)]
    for ancestor in ancestors:
        ancestor_info = FUNCTION_INDEX.get(ancestor)
        if ancestor_info is None:
            continue
        ancestor_fn, ancestor_file_path = ancestor_info
        if ancestor_file_path == node_file_path:
            ancestor_source = (
                get_function_source_from_file(ancestor_fn.name, ancestor_file_path, ancestor_fn.lineno)
                or ancestor_fn.source
            )
            conflict_functions.append(
                format_function_context(ancestor_fn.name, ancestor_file_path, ancestor_source)
            )

    dependent_functions_other_files = []
    for ancestor in ancestors:
        ancestor_info = FUNCTION_INDEX.get(ancestor)
        if ancestor_info is None:
            continue
        ancestor_fn, ancestor_file_path = ancestor_info
        if ancestor_file_path != node_file_path:
            ancestor_source = (
                get_function_source_from_file(ancestor_fn.name, ancestor_file_path, ancestor_fn.lineno)
                or ancestor_fn.source
            )
            dependent_functions_other_files.append(
                format_function_context(ancestor_fn.name, ancestor_file_path, ancestor_source)
            )

    payload = {
        "file_content": file_content,
        "commit_message": LATEST_COMMIT_MESSAGE,
        "readme_content": readme_content,
        "conflict_functions": conflict_functions,
        "ancestor_functions_other_files": dependent_functions_other_files,
    }
    print(payload)
    print("--------------------------------")
    print("--------------------------------")
    try:
        ws_url = "ws://10.30.197.121:8000/generate-tests"
        with connect(ws_url, open_timeout=10, close_timeout=10) as websocket:
            websocket.send(json.dumps(payload))
            response = websocket.recv()
            try:
                print("[generate-tests] Response JSON:", json.loads(response))
            except (TypeError, ValueError):
                print("[generate-tests] Response text:", response)
    except Exception as e:
        print(f"[generate-tests] WebSocket request failed: {e}")


def send_generate_merge_request(
    node: str,
    ancestors: set[str],
):
    node_info = FUNCTION_INDEX.get(node)
    if node_info is None:
        print(f"[generate-tests] Node not found in index: {node}")
        return

    node_fn, node_file_path = node_info

    try:
        with open(node_file_path, "r", encoding="utf-8") as f:
            raw_file_content = f.read()
    except OSError as e:
        print(f"[generate-tests] Failed to read file {node_file_path}: {e}")
        return

    file_content = (
        f"file_name: {node_file_path}\n"
        "file_content:\n"
        f"{raw_file_content}"
    )

    readme_content = ""
    readme_path = get_project_root() / "README.md"
    try:
        with open(readme_path, "r", encoding="utf-8") as f:
            readme_content = (
                f"file_name: {readme_path}\n"
                "file_content:\n"
                f"{f.read()}"
            )
    except OSError as e:
        print(f"[generate-tests] Failed to read README at {readme_path}: {e}")

    # Pull source from actual file line ranges at request-time.
    node_source = get_function_source_from_file(node_fn.name, node_file_path, node_fn.lineno) or node_fn.source
    conflict_functions = [format_function_context(node_fn.name, node_file_path, node_source)]
    for ancestor in ancestors:
        ancestor_info = FUNCTION_INDEX.get(ancestor)
        if ancestor_info is None:
            continue
        ancestor_fn, ancestor_file_path = ancestor_info
        if ancestor_file_path == node_file_path:
            ancestor_source = (
                get_function_source_from_file(ancestor_fn.name, ancestor_file_path, ancestor_fn.lineno)
                or ancestor_fn.source
            )
            conflict_functions.append(
                format_function_context(ancestor_fn.name, ancestor_file_path, ancestor_source)
            )

    dependent_functions_other_files = []
    for ancestor in ancestors:
        ancestor_info = FUNCTION_INDEX.get(ancestor)
        if ancestor_info is None:
            continue
        ancestor_fn, ancestor_file_path = ancestor_info
        if ancestor_file_path != node_file_path:
            ancestor_source = (
                get_function_source_from_file(ancestor_fn.name, ancestor_file_path, ancestor_fn.lineno)
                or ancestor_fn.source
            )
            dependent_functions_other_files.append(
                format_function_context(ancestor_fn.name, ancestor_file_path, ancestor_source)
            )

    payload = {
        "file_content": file_content,
        "commit_message_a": LATEST_REMOTE_CONTENT,
        "commit_message_b": LATEST_CURRENT_CONTENT,
        "conflict_functions": conflict_functions,
        "ancestor_functions_other_files": dependent_functions_other_files,
    }
    print(payload)
    print("--------------------------------")
    print("--------------------------------")
    try:
        ws_url = "ws://10.30.197.121:8000/generate-merge"
        with connect(ws_url, open_timeout=10, close_timeout=10) as websocket:
            websocket.send(json.dumps(payload))
            response = websocket.recv()
            try:
                print("[generate-tests] Response JSON:", json.loads(response))
            except (TypeError, ValueError):
                print("[generate-tests] Response text:", response)
    except Exception as e:
        print(f"[generate-tests] WebSocket request failed: {e}")



def send_generate_feedback_request(
    node: str,
    ancestors: set[str],
):
    node_info = FUNCTION_INDEX.get(node)
    if node_info is None:
        print(f"[generate-tests] Node not found in index: {node}")
        return

    node_fn, node_file_path = node_info

    try:
        with open(node_file_path, "r", encoding="utf-8") as f:
            raw_file_content = f.read()
    except OSError as e:
        print(f"[generate-tests] Failed to read file {node_file_path}: {e}")
        return

    file_content = (
        f"file_name: {node_file_path}\n"
        "file_content:\n"
        f"{raw_file_content}"
    )

    readme_content = ""
    readme_path = get_project_root() / "README.md"
    try:
        with open(readme_path, "r", encoding="utf-8") as f:
            readme_content = (
                f"file_name: {readme_path}\n"
                "file_content:\n"
                f"{f.read()}"
            )
    except OSError as e:
        print(f"[generate-tests] Failed to read README at {readme_path}: {e}")

    # Pull source from actual file line ranges at request-time.
    node_source = get_function_source_from_file(node_fn.name, node_file_path, node_fn.lineno) or node_fn.source
    conflict_functions = [format_function_context(node_fn.name, node_file_path, node_source)]
    for ancestor in ancestors:
        ancestor_info = FUNCTION_INDEX.get(ancestor)
        if ancestor_info is None:
            continue
        ancestor_fn, ancestor_file_path = ancestor_info
        if ancestor_file_path == node_file_path:
            ancestor_source = (
                get_function_source_from_file(ancestor_fn.name, ancestor_file_path, ancestor_fn.lineno)
                or ancestor_fn.source
            )
            conflict_functions.append(
                format_function_context(ancestor_fn.name, ancestor_file_path, ancestor_source)
            )

    dependent_functions_other_files = []
    for ancestor in ancestors:
        ancestor_info = FUNCTION_INDEX.get(ancestor)
        if ancestor_info is None:
            continue
        ancestor_fn, ancestor_file_path = ancestor_info
        if ancestor_file_path != node_file_path:
            ancestor_source = (
                get_function_source_from_file(ancestor_fn.name, ancestor_file_path, ancestor_fn.lineno)
                or ancestor_fn.source
            )
            dependent_functions_other_files.append(
                format_function_context(ancestor_fn.name, ancestor_file_path, ancestor_source)
            )

    payload = {
        "file_content": file_content,
        "commit_message_a": LATEST_REMOTE_CONTENT,
        "commit_message_b": LATEST_CURRENT_CONTENT,
        "conflict_functions": conflict_functions,
        "ancestor_functions_other_files": dependent_functions_other_files,
        "feedback": "testing"
    }
    print(payload)
    print("--------------------------------")
    print("--------------------------------")
    try:
        ws_url = "ws://10.30.197.121:8000/generate-feedback"
        with connect(ws_url, open_timeout=10, close_timeout=10) as websocket:
            websocket.send(json.dumps(payload))
            response = websocket.recv()
            try:
                print("[generate-tests] Response JSON:", json.loads(response))
            except (TypeError, ValueError):
                print("[generate-tests] Response text:", response)
    except Exception as e:
        print(f"[generate-tests] WebSocket request failed: {e}")



def get_subgraph(G: nx.DiGraph, node: str, direct_only: bool = False) -> nx.DiGraph:
    if node not in G:
        return G.copy()
    ancestors = nx.ancestors(G, node)
    if direct_only:
        nodes = set(G.predecessors(node)) | {node}
    else:
        nodes = ancestors | {node}
        
    T = nx.DiGraph()
    # Preserve node attributes (especially "label") so UI shows function names.
    T.add_nodes_from((n, G.nodes[n]) for n in nodes)
    for source, target in G.edges():
        if source in nodes and target in nodes:
            if direct_only:
                # Keep only edges that end at target for direct-caller view
                if target == node:
                    T.add_edge(source, target)
            else:
                if nx.has_path(G, target, node):
                    T.add_edge(source, target)\
                        
    send_generate_tests_request(node, ancestors)
    send_generate_merge_request(node, ancestors)
    send_generate_feedback_request(node, ancestors)
    
    return T

def _fast_grid_positions(nodes: list[str], scale: float = 220.0) -> dict[str, tuple[float, float]]:
    if not nodes:
        return {}
    cols = max(1, int(math.sqrt(len(nodes))))
    positions = {}
    for idx, node in enumerate(nodes):
        row = idx // cols
        col = idx % cols
        positions[node] = (col * scale, row * scale)
    return positions

def to_react_flow(G: nx.DiGraph) -> dict:
    if len(G.nodes()) <= 150:
        pos = nx.spring_layout(G, seed=42, scale=400)
    else:
        pos = _fast_grid_positions(list(G.nodes()))
    nodes = [
        {
            "id": str(node),
            "data": {"label": G.nodes[node].get("label", str(node))},
            "position": {"x": float(pos[node][0]), "y": float(pos[node][1])}
        }
        for node in G.nodes()
    ]
    edges = [
        {
            "id": f"edge-{source}-{target}",
            "source": str(source),
            "target": str(target),
            "markerEnd": {"type": "arrowclosed"}
        }
        for source, target in G.edges()
    ]
    return {"nodes": nodes, "edges": edges}




async def handler(websocket):
    global LATEST_COMMIT_MESSAGE, LATEST_REMOTE_CONTENT, LATEST_CURRENT_CONTENT
    payload_raw = await websocket.recv()
    direct_only = True
    pwd = ""
    conflicted_functions = ""
    conflicted_functions_map: dict[str, list[str]] = {}
    target_function = ""
    curr = ""
    remote = ""
    commit = ""

    # Backward compatible:
    # - If payload is a plain string, treat it as project path.
    # - If payload is JSON, support both old keys and extension "t*" keys.
    payload = payload_raw
    if isinstance(payload_raw, str):
        try:
            payload = json.loads(payload_raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            payload = payload_raw

    if isinstance(payload, dict):
        # print(f"Payload: {payload}")
        pwd = payload.get("pwd", payload.get("tpwd", payload.get("path", "")))
        print(f"PWD: {pwd}")
        conflicted_functions = payload.get("conflicted_functions", payload.get("tconflictedFunctions", ""))
        print(f"Conflicted functions: {conflicted_functions}")
        conflicted_functions_map = _parse_conflicted_functions(conflicted_functions)
        target_function = payload.get("target_function", payload.get("ttargetFunction", payload.get("targetFunction", "")))
        print(f"Target function: {target_function}")
        curr = payload.get("curr", payload.get("tcurr", ""))
        print(f"Curr: {curr}")
        remote = payload.get("remote", payload.get("tremote", ""))
        print(f"Remote: {remote}")
        commit = payload.get("commit", payload.get("tcommit", ""))
        print(f"Commit: {commit}")
        direct_only = bool(payload.get("direct_only", payload.get("directOnly", direct_only)))
        print(f"Direct only: {direct_only}")
    elif isinstance(payload, str):
        pwd = payload

    LATEST_CURRENT_CONTENT = curr
    LATEST_REMOTE_CONTENT = remote
    LATEST_COMMIT_MESSAGE = commit

    await websocket.send(json.dumps({"type": "ack", "message": "Building graph..."}))

    try:
        G = await asyncio.to_thread(build_dependency_graph, Path(pwd))
        target_candidates = [n for n, data in G.nodes(data=True) if data.get("label") == target_function]

        # Prefer the target from the conflicted file to avoid cross-file name collisions.
        if target_candidates and conflicted_functions_map:
            preferred_files = set()
            pwd_path = Path(pwd).resolve()
            for rel_path, fn_names in conflicted_functions_map.items():
                if target_function in fn_names:
                    preferred_files.add(str((pwd_path / rel_path).resolve()))
            if preferred_files:
                scoped_candidates = [
                    node_id for node_id in target_candidates
                    if str(node_id).split(":", 1)[0] in preferred_files
                ]
                if scoped_candidates:
                    target_candidates = scoped_candidates

        target = None
        if target_candidates:
            # If multiple functions share the same name, pick the one with the most callers.
            target = max(target_candidates, key=lambda node_id: G.in_degree(node_id))
        if not target:
            await graph_queue.put({
                "error": (
                    f"Target function '{target_function}' was not found in a parseable Python AST. "
                    "Resolve merge markers in that function and retry."
                )
            })
            return

        T = await asyncio.to_thread(get_subgraph, G, target, direct_only)
        graph_data = await asyncio.to_thread(to_react_flow, T)
    except Exception as exc:
        await graph_queue.put({"error": f"Failed to build graph: {exc}"})
        return

    await graph_queue.put(graph_data)

async def react_flow_server(websocket):
    try:
        graph_data = await asyncio.wait_for(graph_queue.get(), timeout=300)
    except asyncio.TimeoutError:
        await websocket.send(json.dumps({"type": "error", "message": "Timed out waiting for graph data"}))
        return

    if "error" in graph_data:
        await websocket.send(json.dumps({"type": "error", "message": graph_data["error"]}))
        return

    nodes = graph_data["nodes"]
    edges = graph_data["edges"]

    await websocket.send(json.dumps({"type": "start", "nodeCount": len(nodes), "edgeCount": len(edges)}))

    for node in nodes:
        await websocket.send(json.dumps({"type": "add_node", "node": node}))

    for edge in edges:
        await websocket.send(json.dumps({"type": "add_edge", "edge": edge}))

    await websocket.send(json.dumps({"type": "done"}))

    try:
        await websocket.wait_closed()
    except Exception:
        pass

async def main():
    async with websockets.serve(handler, "127.0.0.1", 8765), \
               websockets.serve(react_flow_server, "127.0.0.1", 8000):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())