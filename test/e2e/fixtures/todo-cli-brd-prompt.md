Build a Node.js CLI todo application.

Requirements:
- Commands: add <text>, list, complete <id>, delete <id>
- Storage: todos.json file in current directory
- Fields per todo: id (auto-increment integer), text (string), completed (boolean), createdAt (ISO 8601 timestamp)
- List output: formatted table showing id, status checkbox, text, age
- Exit codes: 0 on success, 1 on error (missing args, invalid id)
- No external dependencies beyond Node.js built-ins

Success metrics:
- All 4 CRUD commands work with correct exit codes (0 success, 1 error)
- JSON file persists between invocations and survives process restart
- List output is human-readable in 80-column terminal
- add command returns the new todo ID to stdout
- delete of non-existent ID returns exit code 1 with error message

Non-goals:
- No GUI, no web interface, no API server
- No database, no network calls
- No user authentication
- No concurrent access handling
