# System Design: Todo CLI

## Architecture
Single-process Node.js CLI application.

## Components
- **todo.js** — Entry point. Parses process.argv, dispatches to command handlers.
- **storage.js** — Reads/writes todos.json. Handles file creation on first use.

## Data Flow
1. User runs `node todo.js <command> [args]`
2. todo.js parses command and arguments
3. storage.js loads todos from todos.json
4. Command handler modifies todo list
5. storage.js writes updated list back to todos.json
