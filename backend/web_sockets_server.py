import asyncio
import websockets
from dependency_graph_file_getter_helper import get_all_files, extract_functions
from collections import deque
from pathlib import Path
import json
import networkx as nx

graph_data = {"nodes": [], "edges": []}
data_ready = asyncio.Event()

def build_dependency_graph(root: Path):
    G = nx.DiGraph()
    fn_dict = {}
    dir_queue = deque([root])
    file_queue = deque()
    get_all_files(root, dir_queue, file_queue)

    while file_queue:
        current = file_queue.popleft()
        functions = extract_functions(current)
        for fn in functions:
            if fn.name not in fn_dict:
                fn_dict[fn.name] = fn

    for key, fn in fn_dict.items():
        G.add_node(key)
        for call in fn.calls:
            if call in fn_dict:
                G.add_edge(key, call)
    return G

def get_subgraph(G: nx.DiGraph, node: str, direct_only: bool = False) -> nx.DiGraph:
    if direct_only:
        nodes = set(G.predecessors(node)) | {node}
    else:
        ancestors = nx.ancestors(G, node)
        nodes = ancestors | {node}
    T = nx.DiGraph()
    T.add_nodes_from(nodes)
    for source, target in G.edges():
        if source in nodes and target in nodes:
            if direct_only:
                # Keep only edges that end at target for direct-caller view
                if target == node:
                    T.add_edge(source, target)
            else:
                if nx.has_path(G, target, node):
                    T.add_edge(source, target)
    return T

def to_react_flow(G: nx.DiGraph) -> dict:
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
            "id": f"edge-{source}-{target}",
            "source": str(source),
            "target": str(target),
            "markerEnd": {"type": "arrowclosed"}
        }
        for source, target in G.edges()
    ]
    return {"nodes": nodes, "edges": edges}

async def handler(websocket):
    global graph_data
    pwd = await websocket.recv()
    G = build_dependency_graph(Path(pwd))
    T = get_subgraph(G, "get_all_files", direct_only=True)
    graph_data = to_react_flow(T)
    data_ready.set()

async def react_flow_server(websocket):
    try:
        await asyncio.wait_for(data_ready.wait(), timeout=60)
    except asyncio.TimeoutError:
        await websocket.send(json.dumps({"type": "error", "message": "Timed out waiting for graph data"}))
        return

    nodes = graph_data["nodes"]
    edges = graph_data["edges"]

    await websocket.send(json.dumps({"type": "start", "nodeCount": len(nodes), "edgeCount": len(edges)}))

    for node in nodes:
        await websocket.send(json.dumps({"type": "add_node", "node": node}))
        await asyncio.sleep(3)

    for edge in edges:
        await websocket.send(json.dumps({"type": "add_edge", "edge": edge}))
        await asyncio.sleep(3)

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