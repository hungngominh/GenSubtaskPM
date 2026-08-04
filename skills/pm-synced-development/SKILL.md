---
name: pm-synced-development
description: Use when executing implementation plans with independent tasks AND you want each task's progress mirrored into the Alliance ITSC PM system via MCP-GenSubTask's tools
---

# PM-Synced Development

Runs the same per-task loop as superpowers:subagent-driven-development (fresh subagent per task,
two-stage review), with PM system sync calls woven into four specific points. Use this instead of
subagent-driven-development when the user wants task progress visible on the PM board as work happens.

**Requires:** the MCP-GenSubTask server's 8 tools available in this session, and a `parent_task_id` for
the PM task these subtasks nest under (ask the user if not already known — resolve via `pm_setup` then
look it up in the PM system if needed, or create one with `pm_create_parent_task`; never guess it).

## The Process

Follow superpowers:subagent-driven-development's process exactly, with these 4 additions:

1. **After** "Read plan, extract all tasks with full text, note context, create TodoWrite" — call
   `pm_create_subtasks(parent_task_id, tasks)` once, using each task's title/description from the plan.
   Keep the returned `{id, code}` per task alongside its TodoWrite entry so later steps know which PM
   `task_id` maps to which plan task.

2. **Before** dispatching each task's implementer subagent — call `pm_start_subtask(task_id)` for that
   task's PM id.

3. **When** the code quality reviewer subagent returns APPROVE for a task — call
   `pm_complete_subtask(task_id)` for that task's PM id, immediately after marking it complete in
   TodoWrite.

4. **After** all tasks are complete, before dispatching the final whole-implementation code reviewer —
   call `pm_audit_status(parent_task_id)` and resolve anything it flags before finishing.

Everything else — implementer prompts, spec review, code quality review, status handling (DONE /
DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED), continuous execution without pausing between tasks — is
identical to superpowers:subagent-driven-development. This skill does not replace or modify that skill's
files; it is a separate process that happens to follow the same shape.

## Red Flags

**Never:**
- Call `pm_start_subtask` for a task before its implementer subagent is actually dispatched (marks the PM
  board as in-progress before work starts).
- Call `pm_complete_subtask` before code quality review has returned APPROVE (marks the PM board as done
  before it's verified).
- Skip `pm_create_subtasks` and call `pm_start_subtask`/`pm_complete_subtask` with a fabricated `task_id`
  — always use the id returned by `pm_create_subtasks` (or found via `pm_setup`/PM lookup for pre-existing
  tasks).
- Skip the final `pm_audit_status` call — it is the only check for sync calls missed mid-loop.
