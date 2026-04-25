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
        
    keys = list(dict.keys())
    for key in keys:
        if key not in G:
            G.add_node(key)
        for call in dict[key].calls:
            if call in dict:
                G.add_edge(key, call)
    return G

def get_subgraph(G: nx.DiGraph, node: str) -> nx.DiGraph:
    ancestors = nx.ancestors(G, node)
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