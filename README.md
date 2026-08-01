# MCP-GenSubTask

MCP server + Claude Code skill that creates and syncs subtasks with the Alliance ITSC PM system while
implementation work happens locally.

## Setup

1. `npm install`
2. Set `PM_API_KEY` (and optionally `PM_API_URL`, defaults to `https://pm-api.allianceitsc.com`) in your
   environment, or let the `pm_setup` tool ask for it on first use — it is then stored in
   `.pm-sync-config.json` in the calling project's directory (gitignored).
3. Add this plugin's `.mcp.json` entry to your Claude Code MCP configuration (already bundled for
   plugin installs).

## Tools

| Tool | Purpose |
|---|---|
| `pm_setup` | Resolve and validate `PM_API_KEY` against the PM system. |
| `pm_create_subtasks` | Create PM subtasks under a parent task, deduplicated. |
| `pm_start_subtask` | Mark a subtask DOING + log a Started-at checklist entry. |
| `pm_complete_subtask` | Mark a subtask DONE at 100% + log a Completed-at checklist entry. |
| `pm_update_progress` | Patch `progress_percent` / `status_code` / `actual_hours` mid-task. |
| `pm_audit_status` | Read-only cross-check of local sync state vs. the live PM system. |

## Skill

`skills/pm-synced-development/SKILL.md` — use instead of superpowers' `subagent-driven-development` when
you want PM board sync woven into the same per-task loop.

## Testing

- `npm test` — unit tests, HTTP layer mocked, no live calls.
- `node scripts/manual-e2e.js <parent_task_id>` — manual/live verification against the real PM API.
  Requires a real `PM_API_KEY` and a real `parent_task_id`. Not run in CI.

## State

`.pm-sync-state.json` (gitignored) in the calling project's directory tracks the local title → PM task id
mapping used for dedup and audit. Safe to delete — subtasks will simply be re-checked against the live
PM system on next `pm_create_subtasks` call.
