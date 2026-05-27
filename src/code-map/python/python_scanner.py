"""cdd-kit Python AST scanner — batch mode, NDJSON output."""
from __future__ import annotations

import ast
import json
import os
import sys
import traceback


def _check_python_version() -> None:
    if sys.version_info < (3, 9):
        print(
            f"cdd-kit: python interpreter is {sys.version_info.major}.{sys.version_info.minor} "
            f"(need 3.9+ for ast.unparse); skipping .py files",
            file=sys.stderr,
        )
        sys.exit(3)


def _rel_path(abs_path: str, repo_root: str) -> str:
    try:
        rel = os.path.relpath(abs_path, repo_root)
    except ValueError:
        # Windows: different drive — use abs_path
        rel = abs_path
    return rel.replace("\\", "/")


def _is_all_caps(name: str) -> bool:
    """Return True if name matches /^[A-Z][A-Z0-9_]*$/ and contains at least one letter."""
    if not name:
        return False
    if not name[0].isupper():
        return False
    if not all(c.isupper() or c.isdigit() or c == '_' for c in name):
        return False
    return any(c.isalpha() for c in name)


def _expr_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _expr_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    if isinstance(node, ast.Call):
        return _expr_name(node.func)
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _calls_in(node: ast.AST, caller: str) -> list[dict]:
    calls: list[dict] = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call):
            callee = _expr_name(sub.func)
            if callee:
                calls.append({
                    "caller": caller,
                    "callee": callee,
                    "line": sub.lineno,
                })
    return calls


def scan_file(abs_path: str, repo_root: str) -> dict:
    src = open(abs_path, encoding="utf-8").read()
    total_lines = len(src.splitlines()) if src else 0

    # Check first 4KB for binary content
    head = src[:4096]
    if '\x00' in head:
        return {
            "path": _rel_path(abs_path, repo_root),
            "ok": False,
            "error": "binary file (null bytes detected)",
        }

    try:
        tree = ast.parse(src, filename=abs_path)
    except SyntaxError as exc:
        return {
            "path": _rel_path(abs_path, repo_root),
            "ok": False,
            "error": str(exc),
        }
    except UnicodeDecodeError as exc:
        return {
            "path": _rel_path(abs_path, repo_root),
            "ok": False,
            "error": str(exc),
        }

    imports: list[dict] = []
    constants: list[dict] = []
    classes: list[dict] = []
    functions: list[dict] = []
    calls: list[dict] = []
    exports: list[dict] = []

    for node in ast.iter_child_nodes(tree):
        # ── imports ──────────────────────────────────────────────────────────
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({
                    "module": alias.name,
                    "items": [],
                    "line": node.lineno,
                })
        elif isinstance(node, ast.ImportFrom):
            level = node.level or 0
            module_name = ("." * level) + (node.module or "")
            items = [a.asname if a.asname else a.name for a in node.names]
            imports.append({
                "module": module_name,
                "items": items,
                "line": node.lineno,
            })

        # ── constants ────────────────────────────────────────────────────────
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and _is_all_caps(target.id):
                    constants.append({"name": target.id, "line": node.lineno})
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and _is_all_caps(node.target.id):
                constants.append({"name": node.target.id, "line": node.lineno})

        # ── classes ──────────────────────────────────────────────────────────
        elif isinstance(node, ast.ClassDef):
            methods: list[dict] = []
            for sub in ast.iter_child_nodes(node):
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    methods.append({
                        "name": sub.name,
                        "lines": [sub.lineno, sub.end_lineno],
                        "async": isinstance(sub, ast.AsyncFunctionDef),
                    })
                    calls.extend(_calls_in(sub, f"{node.name}.{sub.name}"))
            classes.append({
                "name": node.name,
                "lines": [node.lineno, node.end_lineno],
                "methods": methods,
                "extends": [name for name in (_expr_name(base) for base in node.bases) if name],
                "implements": [],
                "exported": True,
            })
            exports.append({"name": node.name, "kind": "class", "line": node.lineno})

        # ── functions ────────────────────────────────────────────────────────
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            decos: list[str] = []
            for d in node.decorator_list:
                try:
                    decos.append(ast.unparse(d))
                except Exception:
                    decos.append("?")
            functions.append({
                "name": node.name,
                "lines": [node.lineno, node.end_lineno],
                "decorators": decos,
                "async": isinstance(node, ast.AsyncFunctionDef),
                "exported": True,
            })
            calls.extend(_calls_in(node, node.name))
            exports.append({"name": node.name, "kind": "function", "line": node.lineno})

    return {
        "path": _rel_path(abs_path, repo_root),
        "total_lines": total_lines,
        "imports": imports,
        "constants": constants,
        "classes": classes,
        "functions": functions,
        "calls": calls,
        "exports": exports,
        "ok": True,
    }


def main() -> None:
    _check_python_version()

    import argparse
    parser = argparse.ArgumentParser(description="cdd-kit Python AST scanner")
    parser.add_argument("--batch-file", required=True, help="File containing one abs path per line")
    parser.add_argument("--repo-root", required=True, help="Repository root for relative paths")
    args = parser.parse_args()

    with open(args.batch_file, encoding="utf-8") as fh:
        paths = [line.rstrip("\n") for line in fh if line.strip()]

    for abs_path in paths:
        try:
            result = scan_file(abs_path, args.repo_root)
        except Exception:
            tb = traceback.format_exc()
            print(json.dumps({"fatal": tb}), file=sys.stderr)
            sys.exit(2)
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
