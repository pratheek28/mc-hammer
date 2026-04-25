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
    def _strip_conflict_markers(text: str) -> str:
        cleaned_lines = []
        for line in text.splitlines(keepends=True):
            stripped = line.lstrip()
            if (
                stripped.startswith("<<<<<<< ")
                or stripped.startswith("=======")
                or stripped.startswith(">>>>>>> ")
            ):
                continue
            cleaned_lines.append(line)
        return "".join(cleaned_lines)

    try:
        with open(filepath, encoding="utf-8", errors="ignore") as f:
            source = f.read()
    except OSError:
        return []
    lines = source.splitlines(keepends=True)
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        # Best-effort parse for unresolved merge conflicts:
        # ignore marker lines and retry so conflicted functions still appear.
        cleaned_source = _strip_conflict_markers(source)
        if cleaned_source == source:
            return []
        try:
            tree = ast.parse(cleaned_source)
            lines = cleaned_source.splitlines(keepends=True)
        except (SyntaxError, ValueError):
            # Skip files that cannot be parsed to avoid aborting large scans.
            return []
    extractor = FunctionExtractor(lines)
    extractor.visit(tree)
    return extractor.functions

def get_all_files(root: Path, dir_queue: deque, file_queue: deque):
    ignored_dirs = {
        ".venv", "__pycache__", ".git", ".vscode", "node_modules",
        ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox",
        "venv", "env", "build", "dist"
    }
    while dir_queue:
        current = dir_queue.popleft()
        if current.is_dir() and current.name not in ignored_dirs:
            for entry in current.iterdir():
                dir_queue.append(entry)
        elif current.is_file() and current.suffix == ".py":
            file_queue.append(current)
