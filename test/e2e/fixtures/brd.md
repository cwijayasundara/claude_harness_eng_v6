# Business Requirements Document: Todo CLI

## Executive Summary
A Node.js command-line todo application for personal task management.

## Goals
- Provide fast, terminal-based task management
- Zero dependencies beyond Node.js built-ins
- Persistent storage via JSON file

## Target Users
- Developers comfortable with CLI tools

## Success Metrics
1. All 4 CRUD commands work with correct exit codes (0 success, 1 error)
2. JSON file persists between invocations
3. List output is human-readable in 80-column terminal

## Scope

### In-Scope
- add, list, complete, delete commands
- JSON file storage (todos.json)
- Auto-increment integer IDs
- ISO 8601 timestamps

### Out-of-Scope
- GUI, web interface, API server
- Database, network calls
- User authentication
- Concurrent access handling

## MVP Definition
CLI with add/list/complete/delete commands using todos.json for storage.

## Alternatives
1. SQLite storage — rejected for simplicity
2. YAML format — rejected for native JSON support in Node.js

## Technical Architecture
Single-process Node.js CLI. Entry point parses argv, dispatches to command handler, reads/writes todos.json.

## Data Model
Todo: { id: number, text: string, completed: boolean, createdAt: string (ISO 8601) }

## Integrations
None — standalone CLI tool.

## Constraints
- Node.js built-ins only
- Single JSON file for storage

## UI Context
Terminal output — formatted table with id, status, text, age columns.

## Open Questions
None for MVP.
