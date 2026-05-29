# Dependency-tracing reference — Python

Heuristics for tracing structure and dependencies in a Python codebase (read-only).

- **Imports**: `import x` / `from x import y` (absolute), `from . import y` / `from ..pkg import y` (relative). Build the module graph from these; resolve relative imports against the package path.
- **Dependencies**: external packages in `pyproject.toml` (`[project].dependencies`, `[tool.*]`) or `requirements*.txt`/`setup.cfg`; the lockfile (`uv.lock`/`poetry.lock`) pins versions.
- **Entry points**: `if __name__ == "__main__"`, `__main__.py`, a FastAPI/Flask app object (`app = FastAPI()`), Click/Typer CLIs, `[project.scripts]` in `pyproject.toml`, Celery/worker entrypoints.
- **Packages**: `__init__.py` presence defines packages; re-exports in `__init__.py` (`from .x import Y`) hide the real definition site — follow them. Namespace packages may lack `__init__.py`.
- **Circular imports**: surface as `ImportError`/`partially initialized module` at runtime; trace cycles in the import graph and note them as risk.
- **Dynamic imports** (`importlib.import_module`, `__import__`, plugin registries) won't show in a static grep — flag any you find as graph blind spots.
- **Symbols**: prefer LSP (pyright) for go-to-definition / find-references over grep when available; fall back to `grep -rn "def name\|class Name"`.
- **Layers**: infer layered architecture from `src/<layer>/` directories and the import direction between them.
