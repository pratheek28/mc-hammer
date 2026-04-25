import networkx as nx
from dependency_graph_file_getter_helper import get_all_files, get_project_root, extract_functions
import matplotlib.pyplot as plt
import os
import pathlib as Path
from collections import deque

def main():
    G = nx.DiGraph()
    dict = {}
    root = get_project_root()
    dir_queue = deque([root])
    file_queue = deque()
    get_all_files(root, dir_queue, file_queue)

    while file_queue:
        current = file_queue.popleft()
        print()
        print()
        print()
        print(f"NOW PRINTING FILE: {current.name}")
        print()
        print()
        print()
        functions = extract_functions(current)
        for fn in functions:
            if fn.name not in dict:
                dict[fn.name] = fn
            print(f"Function: {fn.name}")
            print(f"  Params: {fn.params}")
            print(f"  Returns: {fn.return_annotation}")
            print(f"  Calls: {fn.calls}")

    keys = list(dict.keys())

    for key in keys:
        G.add_node(key)
        for call in dict[key].calls:
            if dict.get(call) is not None:
                G.add_edge(call, key)

    nx.draw(G, with_labels=True)
    plt.show()
    print(dict)

if __name__ == "__main__":
    main()