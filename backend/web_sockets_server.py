#web_sockets_server.py
import asyncio
import websockets
from websockets.sync.client import connect
from dependency_graph_file_getter_helper import get_all_files, get_project_root, extract_functions
from dependency_graph import get_subgraph
from collections import deque
import os
import pathlib as Path
import json
import networkx as nx

FUNCTION_INDEX: dict[str, tuple[object, str]] = {}


def build_dependency_graph():
    G = nx.DiGraph()
    dict = {}
    root = get_project_root()
    dir_queue = deque([root])
    file_queue = deque()
    get_all_files(root, dir_queue, file_queue)

    while file_queue:
        current = file_queue.popleft()
        functions = extract_functions(current)
        for fn in functions:
            if fn.name not in dict:
                dict[fn.name] = fn
                FUNCTION_INDEX[fn.name] = (fn, str(current))
        
    keys = list(dict.keys())
    for key in keys:
        if key not in G:
            G.add_node(key)
        for call in dict[key].calls:
            if call in dict:
                G.add_edge(key, call)
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
        "commit_message": "testtttting",
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

def get_subgraph(G: nx.DiGraph, node: str) -> nx.DiGraph:
    ancestors = nx.ancestors(G, node)
    send_generate_tests_request(node, ancestors)
    nodes = ancestors | {node}
    T = nx.DiGraph()
    T.add_nodes_from(nodes)
    for u, v in G.edges():
        if u in nodes and v in nodes and nx.has_path(G, v, node):
            T.add_edge(u, v)
    return T

def to_react_flow(G: nx.DiGraph) -> list[dict]:
    pos = nx.spring_layout(G, seed=42, scale=400)

    nodes = [
        {
            "id": str(node),
            "data": {"label": node},
            "position": {"x": float(pos[node][0]), "y": float(pos[node][1])}
        }
        for node in G.nodes()
    ]

    edges = [
        {
            "id": f"edge-{edge[0]}-{edge[1]}",
            "source": str(edge[0]),
            "target": str(edge[1]),
            "markerEnd": {"type": "arrowclosed"}
        }
        for edge in G.edges()
    ]

    return {
        "nodes": nodes,
        "edges": edges
    }

G = build_dependency_graph()
T = get_subgraph(G, "get_all_files")
result = to_react_flow(T)
Nodes = result["nodes"]
Edges = result["edges"]
print("Sample node:", Nodes[0] if Nodes else "EMPTY")
print("Sample edge:", Edges[0] if Edges else "EMPTY")

async def handler(websocket):
    print(f"Client connected: {websocket.remote_address}")
    try:
        await websocket.send(json.dumps({"type": "start", "nodeCount": len(Nodes), "edgeCount": len(Edges)}))

        for node in Nodes:
            await websocket.send(json.dumps({"type": "add_node", "node": node}))
            await asyncio.sleep(3)

        for edge in Edges:
            await websocket.send(json.dumps({"type": "add_edge", "edge": edge}))
            await asyncio.sleep(3)

        await websocket.send(json.dumps({"type": "done"}))

    except websockets.exceptions.ConnectionClosed:
        # Client disconnected mid-stream — this is fine, just log it
        print(f"Client disconnected early: {websocket.remote_address}")
    except Exception as e:
        print(f"Handler error: {e}")
        # Only send error if connection is still open
        if websocket.state.name == "OPEN":
            try:
                await websocket.send(json.dumps({"type": "error", "message": str(e)}))
            except Exception:
                pass  # Connection gone, nothing to do


async def main():
    async with websockets.serve(handler, "localhost", 8765):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())