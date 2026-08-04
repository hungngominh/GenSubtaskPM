# MCP-GenSubTask

MCP server + Claude Code skill that creates and syncs subtasks with the Alliance ITSC PM system while
implementation work happens locally.

> **Note (for AI agents & new clones):** after `git clone`/`git pull`, dependencies are not installed
> automatically — run `npm install` before running the server, tests, or any script in this repo.

## Setup

1. `npm install`
2. Set `PM_API_KEY` (and optionally `PM_API_URL`, defaults to `https://pm-api.allianceitsc.com`) in your
   environment, or let the `pm_setup` tool ask for it on first use — it is then stored in
   `.pm-sync-config.json` in the calling project's directory (gitignored).
3. Add this plugin's `.mcp.json` entry to your Claude Code MCP configuration (already bundled for
   plugin installs).

### Quick setup for another project (client machine)

To wire up a *different* project to this same MCP server (no code duplication — it points at this
repo's `mcp/server.js` by absolute path):

```
node scripts/setup-client.js <path-to-target-project>
```

This creates/merges `.mcp.json` in the target project and adds the PM-sync files to its
`.gitignore`. It does not touch the API key — open a Claude Code session in the target project
afterward and run `pm_setup` to enter and validate `PM_API_KEY` (keeps the key out of shell
history and logs).

## Tools

| Tool | Purpose |
|---|---|
| `pm_setup` | Resolve and validate `PM_API_KEY` against the PM system. |
| `pm_create_parent_task` | Create a top-level task (task cha) with no `parent_task_id`, deduplicated by title. |
| `pm_create_subtasks` | Create PM subtasks under a parent task, deduplicated. Agents should resolve `assignee_id` via `pm_list_members` and ask the operator, leaving it unset only if the operator explicitly opts out. |
| `pm_start_subtask` | Mark a subtask DOING + log a Started-at checklist entry. |
| `pm_complete_subtask` | Mark a subtask DONE at 100% + log a Completed-at checklist entry. Requires `actual_hours` (hours worked since the last update); it is added to the task's existing total, not overwritten. |
| `pm_update_progress` | Patch `progress_percent` / `status_code` mid-task. Requires `actual_hours` (hours worked since the last update); it is added to the task's existing total, not overwritten. |
| `pm_audit_status` | Read-only cross-check of local sync state vs. the live PM system. |
| `pm_list_members` | List project members with `user_id`/roles, for resolving `assignee_id`. |

## Skill

`skills/pm-synced-development/SKILL.md` — use instead of superpowers' `subagent-driven-development` when
you want PM board sync woven into the same per-task loop.

## Testing

- `npm test` — unit tests, HTTP layer mocked, no live calls.
- `node scripts/manual-e2e.js <parent_task_id> <assignee_id>` — manual/live verification against the real
  PM API. Requires a real `PM_API_KEY`, a real `parent_task_id`, and a real `assignee_id` (use
  `pm_list_members` to find one). Not run in CI.

## State

`.pm-sync-state.json` (gitignored) in the calling project's directory tracks the local title → PM task id
mapping used for dedup and audit. Safe to delete — subtasks will simply be re-checked against the live
PM system on next `pm_create_subtasks` call.
