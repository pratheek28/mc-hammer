import asyncio
from websockets.asyncio import serve
from websockets.sync.client import connect
from dependency_graph_file_getter_helper import get_all_files, get_project_root, extract_functions
from collections import deque
import os
import pathlib as Path

async def handler(websocket: WebSocket):
    root = get_project_root()
    dir_queue = deque([root])
    file_queue = deque()
    get_all_files(root, dir_queue, file_queue)

    while file_queue:
        current = file_queue.popleft()
        functions = extract_functions(current)
        for fn in functions:
            await websocket.send(fn.name)