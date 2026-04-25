import ast
from dataclasses import dataclass, field
from pathlib import Path
import os
from collections import deque

@dataclass
class FunctionInfo:
    name: str
    params: list[str]
    return_annotation: str | None
    calls: list[str]          # functions this function calls
    decorators: list[str]
    lineno: int
    source: str
    docstring: str | None

class FunctionExtractor(ast.NodeVisitor):
    def __init__(self, source_lines):
        self.functions = []
        self.source_lines = source_lines

    def visit_FunctionDef(self, node):
        # Parameters
        params = [arg.arg for arg in node.args.args]

        # Return annotation
        return_annotation = None
        if node.returns:
            return_annotation = ast.unparse(node.returns)

        # Docstring
        docstring = ast.get_docstring(node)

        # Decorators
        decorators = [ast.unparse(d) for d in node.decorator_list]

        # Function calls made inside this function
        calls = []
        for child in ast.walk(node):
            if isinstance(child, ast.Call):
                if isinstance(child.func, ast.Attribute):
                    # e.g. self.repo.getById() → "repo.getById"
                    calls.append(ast.unparse(child.func))
                elif isinstance(child.func, ast.Name):
                    # e.g. getUser() → "getUser"
                    calls.append(child.func.id)

        # Raw source of just this function
        func_source = "".join(
            self.source_lines[node.lineno - 1 : node.end_lineno]
        )

        self.functions.append(FunctionInfo(
            name=node.name,
            params=params,
            return_annotation=return_annotation,
            calls=calls,
            decorators=decorators,
            lineno=node.lineno,
            source=func_source,
            docstring=docstring
        ))

        # Still visit nested functions if any
        self.generic_visit(node)

    # Handle async functions too
    visit_AsyncFunctionDef = visit_FunctionDef

def get_project_root() -> Path:
    return next(p for p in Path(__file__).absolute().parents if (p / ".git").exists())

def extract_functions(filepath: str) -> list[FunctionInfo]:
    with open(filepath) as f:
        source = f.read()
    lines = source.splitlines(keepends=True)
    tree = ast.parse(source)
    extractor = FunctionExtractor(lines)
    extractor.visit(tree)
    return extractor.functions

def get_all_files(root: Path, dir_queue: deque, file_queue: deque):
    while dir_queue:
        current = dir_queue.popleft()
        if current.is_dir() and current.name != ".venv":
            for entry in current.iterdir():
                dir_queue.append(entry)
        elif current.is_file() and current.suffix == ".py":
            file_queue.append(current)
