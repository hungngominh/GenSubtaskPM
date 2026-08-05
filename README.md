**English** | [Tiếng Việt](README.vi.md)

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
3. Install as a Claude Code plugin — this repo is its own marketplace (`.claude-plugin/marketplace.json`):
   - CLI: `/plugin marketplace add hungngominh/GenSubtaskPM` then `/plugin install pm-gensubtask@gensubtask-pm`
   - VS Code extension: type `/plugins`, open the **Marketplaces** tab, add `hungngominh/GenSubtaskPM`,
     then install `pm-gensubtask` from the **Plugins** tab (`/plugin install` is CLI-only and isn't
     registered in the VS Code extension)

   The bundled `.mcp.json` uses `${CLAUDE_PLUGIN_ROOT}` so the server path resolves automatically
   wherever the plugin is installed — no absolute path to edit.

### Updating

Installed clients do **not** auto-pull new commits pushed to this repo (auto-update is opt-in for
self-hosted marketplaces). After pushing changes, each client needs to run:

```
/plugin marketplace update gensubtask-pm
```

then `/reload-plugins` (or restart Claude Code) to load the new code. To make this automatic instead,
enable auto-update for the marketplace via `/plugin` → **Marketplaces** tab → `gensubtask-pm` →
**Enable auto-update**.

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
| `pm_create_parent_task` | Create a top-level task (task cha) with no `parent_task_id`, deduplicated by title. Optional fields beyond `title`/`description`/`workstream`/`layer`/`assignee_id`: `due_date`, `estimate_hours`, `priority`, `status_code`, `size`, `difficulty`, `impact`, `is_notify_task`, `link_slide` — only set when the operator explicitly asks for that value. |
| `pm_create_subtasks` | Create PM subtasks under a parent task, deduplicated. Agents should resolve `assignee_id` via `pm_list_members` and ask the operator, leaving it unset only if the operator explicitly opts out. Same optional fields as `pm_create_parent_task`, set per subtask. |
| `pm_start_subtask` | Mark a subtask DOING + log a Started-at checklist entry. |
| `pm_complete_subtask` | Mark a subtask DONE at 100% + log a Completed-at checklist entry. Requires `actual_hours` (hours worked since the last update); it is added to the task's existing total, not overwritten. |
| `pm_update_progress` | Patch `progress_percent` / `status_code` mid-task. Requires `actual_hours` (hours worked since the last update); it is added to the task's existing total, not overwritten. |
| `pm_audit_status` | Read-only cross-check of local sync state vs. the live PM system. |
| `pm_list_members` | List project members with `user_id`/roles, for resolving `assignee_id`. |
| `pm_get_task` | Read-only detail lookup for a single task by id — status, assignee, progress, hours, parent link. |
| `pm_list_tasks` | Read-only listing of all active top-level tasks in the project, each with its subtask titles. |
| `pm_add_checklist_items` | Add one or more checklist items (lightweight sub-steps/verification items) to an existing task. Creation only — no get/update/delete for checklist items. |

Note: `assignee_id` and other task fields (`title`, `description`, `workstream`, etc.) cannot be changed on
an existing task — the PM API's `PATCH tasks/:taskId` endpoint only accepts `status_code`, `actual_hours`,
and `progress_percent` (see `bot_tasks.md` §2.6, §3). There is no reassign/rename/delete endpoint.

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
