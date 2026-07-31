# Design: MCP-GenSubTask — PM Subtask Sync

**Date:** 2026-07-31
**Status:** Draft, pending user review

## 1. Purpose

Claude Code plugin that creates and syncs subtasks in the Alliance ITSC PM system
(API documented in `bot_tasks.md`) while implementation work happens locally. Two
parts ship together:

1. An **MCP server** exposing 6 tools that wrap the PM system's bot-agents API.
2. A **skill**, `pm-synced-development`, that runs the same task-execution loop as
   superpowers' `subagent-driven-development` but calls the PM tools at each step.

The MCP server has no code dependency on superpowers or any other plugin — it is a
plain API wrapper. `pm-synced-development` is the integration point: a separate skill
(not a modification of superpowers' own files, which live in a different plugin's
cache and would be overwritten on update) that a user invokes **instead of**
`subagent-driven-development` when they want PM tracking woven into the same loop.

## 2. MCP Server — Tools

All 6 tools call the Alliance ITSC PM bot-agents API per `bot_tasks.md`. Base URL and
key resolve from `PM_API_URL` / `PM_API_KEY` env vars — never hardcoded, never guessed.

| Tool | Input | Behavior |
|---|---|---|
| `pm_setup` | — (reads env) | Resolves `PM_API_URL`/`PM_API_KEY`. If `PM_API_KEY` is unset, asks the user for it. Calls `GET project-info-mini` with the key, shows `name`/`customer_name`, asks the user to confirm before treating the key as valid for the session. Re-confirms only if the key changes or a call unexpectedly returns 401. |
| `pm_create_subtasks` | `parent_task_id` (string), `tasks[]` (each: `title` required, `description?`, `workstream?`, `layer?`, `assignee_id?`) | For each task: check local state file for an existing mapping → if absent, call `GET get-tasks` and check the parent's `subtasks[]` for a title match → if still absent, `POST create-task` with `parent_task_id` set and `workstream`/`layer` defaulted from the parent task's own values when not specified per-item. Writes each successful result to the state file immediately (not batched). Returns the created/skipped list, with a trailing reminder line telling the caller to call `pm_start_subtask`/`pm_complete_subtask` as each task starts/finishes. |
| `pm_start_subtask` | `task_id` | `PATCH tasks/:taskId` with `status_code: "DOING"`. Then `POST tasks/:taskId/checklists` with one `TEXT` item, title `"Started at"`, `value` = current ISO-8601 timestamp. |
| `pm_complete_subtask` | `task_id`, `actual_hours?` | `PATCH tasks/:taskId` with `status_code: "DONE"`, `progress_percent: 100`, and `actual_hours` if given. Then `POST tasks/:taskId/checklists` with one `TEXT` item, title `"Completed at"`, `value` = current ISO-8601 timestamp. |
| `pm_update_progress` | `task_id`, `progress_percent?`, `status_code?`, `actual_hours?` | `PATCH tasks/:taskId` passthrough with whichever fields are given (at least one required, matching the API's own validation). Does not touch checklists. |
| `pm_audit_status` | `parent_task_id` | Reads the state file's task list for this parent, calls `GET get-tasks`, cross-checks each tracked task's live `status_code`/`progress_percent` against what the state file last recorded. Reports tasks that look stuck — e.g. still `BACKLOG`/`PICK` despite local state showing work has started, or `DOING` with no matching `pm_complete_subtask` call recorded. Read-only; makes no PM API writes. |

### Tool descriptions double as usage instructions

Since no hook forces these calls, each tool's MCP `description` field states plainly
when to call it (e.g. `pm_start_subtask`: "Call right before starting real work on a
task that has a PM subtask — not before."). This is the fallback for any caller not
using the `pm-synced-development` skill.

## 3. Skill — `pm-synced-development`

A companion skill bundled in this same plugin. Structurally mirrors
`subagent-driven-development`'s per-task loop (implementer → spec review → code
review → mark complete), adding PM sync calls at four points:

| Step in the loop | PM call added |
|---|---|
| After extracting all tasks from the plan and creating the TodoWrite list | `pm_create_subtasks(parent_task_id, tasks[])` — `parent_task_id` is supplied by the user or resolved via `pm_setup`/`get-tasks` lookup before the loop starts |
| Immediately before dispatching each task's implementer subagent | `pm_start_subtask(task_id)` |
| Immediately after code quality review returns APPROVE for a task | `pm_complete_subtask(task_id, actual_hours?)` |
| After all tasks are complete, before the final whole-branch review | `pm_audit_status(parent_task_id)` — surfaces any task the loop may have left in an inconsistent PM state before wrapping up |

This skill does not modify or read any file belonging to the superpowers plugin. A
user chooses `pm-synced-development` over `subagent-driven-development` when they want
both; the two are not composed automatically.

## 4. State File

Path: `.pm-sync-state.json` in the calling project's working directory.

```json
{
  "<parent_task_id>": {
    "tasks": {
      "<task title>": { "id": "...", "code": "TASK-0021", "status": "DOING" }
    }
  }
}
```

Keyed by `parent_task_id` (not by plan file path) so the same mechanism works
regardless of which workflow or plugin drives task creation. Written synchronously
after every successful create/update — a crash mid-run loses at most the one in-flight
call, not prior progress.

## 5. Error Handling

Mirrors `bot_tasks.md` §4 exactly — no generic retry-everything logic:

| Status | Behavior |
|---|---|
| `401` | Stop immediately. Do not retry. Report as a configuration problem. |
| `400` | Read `message`, fix only the offending field against the documented enums, retry once. Never invent a value or drop the field silently. |
| `403` | Cross-project `task_id` — do not retry. Report the mismatch. |
| `404` | Do not retry blindly — re-fetch `get-tasks` to confirm the id before trying again. |
| `409` | Treat as already-exists, not an error — look up the existing resource. |
| `500` | Retry once after a short backoff. Stop and report if it fails again. |

The `message` field from any error response is always surfaced back to the caller —
never swallowed.

## 6. Testing

- Unit tests mock the HTTP layer — no live calls. Cover: dedup logic (state file hit,
  `get-tasks` fallback, both-miss create path), error classification per status code,
  checklist payload shape (`items[].input_type: "TEXT"`, `items[].value`).
- One manual/integration script that calls the real API (requires a real
  `PM_API_KEY`) to verify end-to-end before considering the server done — mirrors this
  project's general practice of confirming live behavior, not just mocks.

## 7. Out of Scope

- Editing task fields other than `status_code`/`actual_hours`/`progress_percent` — the
  underlying API has no endpoint for this (see `bot_tasks.md` §3).
- Deleting tasks or checklist items — no endpoint exists.
- Assignee resolution / `get-members` lookups — not needed for the create/sync flow
  this design covers; can be added later as a 7th tool if a real need shows up.
- Automatic composition of `pm-synced-development` with other superpowers skills
  beyond `subagent-driven-development`'s shape — out of scope until a concrete need
  arises.
