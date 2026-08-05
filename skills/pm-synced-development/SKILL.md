---
name: pm-synced-development
description: Use when executing implementation plans with independent tasks AND you want each task's progress mirrored into the Alliance ITSC PM system via MCP-GenSubTask's tools
---

# PM-Synced Development

Runs the same per-task loop as superpowers:subagent-driven-development (fresh subagent per task,
two-stage review), with PM system sync calls woven into six specific points — including the process's
own trailing closing steps (final review, branch finishing) and closing out the parent task itself once
the human operator signs off. Use this instead of subagent-driven-development when the user wants task
progress visible on the PM board as work happens.

**Requires:** the MCP-GenSubTask server's 8 tools available in this session, and a `parent_task_id` for
the PM task these subtasks nest under (ask the user if not already known — resolve via `pm_setup` then
look it up in the PM system if needed, or create one with `pm_create_parent_task`; never guess it).

## Multiple Parent Tasks

A plan sometimes covers more than one independent feature/epic that the operator wants as **separate
top-level board items**, not all nested under one umbrella parent. `pm_create_parent_task` creates one
parent at a time — there is no batch-create endpoint for parents (unlike `pm_create_subtasks` for
children) — so:

1. **Decide the grouping with the operator before creating anything.** Don't infer from the plan's task
   headings alone whether it's "one feature, N tasks" (single parent, the default) or "N features, each
   with its own tasks" (N parents). Ask if it's ambiguous — there is no delete endpoint for parent tasks,
   so a wrongly-created one can't be cleaned up if you guess wrong.
2. **Create each parent individually**, one `pm_create_parent_task` call per group (it already skips
   creation and returns the existing id if a same-titled top-level task exists, so re-running is safe).
   Collect each group's `parent_task_id` before touching its subtasks.
3. **Run the full 6-addition process independently per parent.** Each group gets its own
   `pm_create_subtasks` batch (Analysis & Planning entry + that group's plan tasks + that group's trailing
   closing steps), its own per-task start/complete calls, its own `pm_audit_status`, and its own addition-6
   parent-close call gated on the operator's approval *of that group specifically* — approving group A's
   work is not approval to close group B's parent.
4. **Split shared work across parents honestly.** If the Analysis & Planning phase (or a closing step like
   a single whole-branch review) genuinely covered multiple groups at once rather than one, don't
   duplicate its full hours into every parent's total — split the actual time across the groups it
   covered, or ask the operator how they want it attributed, and note the split so it's auditable.

For a single-feature plan (the common case), skip this section — one `parent_task_id`, one pass through
the process below.

## The Process

Follow superpowers:subagent-driven-development's process exactly, with these 6 additions:

1. **After** "Read plan, extract all tasks with full text, note context, create TodoWrite" — build the
   PM subtask list from **three sources**, not just the plan:
   - A leading "Phân tích & Lập kế hoạch" (Analysis & Planning) entry for the brainstorming/plan-writing
     work (`superpowers:brainstorming` + `superpowers:writing-plans`) that produced this plan — this
     happened *before* this skill's process starts, so if it isn't already tracked elsewhere on the PM
     board, it must be captured here or its hours are permanently lost from the parent's total.
   - Each plan task's title/description.
   - The process's own trailing steps that always run after the last plan task, as their own entries —
     at minimum "Final whole-branch review" (the final whole-implementation code reviewer dispatch), plus
     whichever concrete closing steps `superpowers:finishing-a-development-branch` and any project-specific
     verification gate will require for this plan (e.g. a live-API/manual verification step, a workspace
     cleanup / branch-finish step). Add these to the same TodoWrite list so they're visible up front, not
     discovered after the fact.

   Call `pm_create_subtasks(parent_task_id, tasks)` **once** for this combined list. Keep the returned
   `{id, code}` per item alongside its TodoWrite entry so later steps know which PM `task_id` maps to
   which plan task or closing step. Because the Analysis & Planning entry represents work already
   finished, immediately call `pm_start_subtask` then `pm_complete_subtask` for it right after creation
   (not deferred like the other entries), recording the hours that phase actually took — ask the operator
   for that figure if it wasn't tracked live.

2. **Before** dispatching each task's implementer subagent — call `pm_start_subtask(task_id)` for that
   task's PM id.

3. **When** the code quality reviewer subagent returns APPROVE for a task — call
   `pm_complete_subtask(task_id)` for that task's PM id, immediately after marking it complete in
   TodoWrite.

4. **For each trailing closing step created in addition 1** (final whole-branch review, live-API
   verification, workspace cleanup, etc.) — call `pm_start_subtask(task_id)` immediately before starting
   that step, and `pm_complete_subtask(task_id)` immediately after it finishes successfully, same as a
   plan task. This includes the final whole-implementation code reviewer dispatch and the steps inside
   `superpowers:finishing-a-development-branch`.

5. **After** all tasks and all trailing closing steps are complete — call `pm_audit_status(parent_task_id)`
   and resolve anything it flags before finishing.

6. **After** the audit is clean **and** the human operator has explicitly approved the finished work
   (e.g. approves the final whole-branch review, says to merge/ship, confirms "looks good") — call
   `pm_complete_subtask(parent_task_id, actual_hours)` to close out the parent task itself at 100%
   progress. `actual_hours` is a delta on the parent same as any subtask (see tool description) — sum the
   hours actually spent across the *whole* effort, including the Analysis & Planning entry from addition 1,
   every plan task, and every trailing closing step (or ask the operator for a figure if hours weren't
   tracked per item) rather than guessing or only counting implementation tasks. Do this even though the
   parent was never `pm_start_subtask`'d
   directly — its own progress tracks the aggregate of its children, and this call is what surfaces that
   completion on the PM board.

   **Never** call this before explicit operator approval — a clean `pm_audit_status` means the subtasks
   are in sync, not that the human has signed off on the work. If the operator's approval is ambiguous,
   ask directly before closing the parent.

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
- Build the initial `pm_create_subtasks` batch from plan tasks alone and forget the trailing closing steps
  (final review, verification, workspace cleanup) — they must be in the *same* batch call, decided up
  front, not created ad hoc after the operator notices they're missing from the board.
- Skip the final `pm_audit_status` call — it is the only check for sync calls missed mid-loop.
- Call `pm_complete_subtask(parent_task_id, ...)` before the human operator has explicitly approved the
  finished work — a clean audit is not approval. Likewise, never leave the parent task open after the
  operator has clearly approved; that's the one call this skill must not forget to make.
- Guess `actual_hours` for the parent-close call out of nowhere — sum what was tracked per task/step, or
  ask the operator.
- Leave the brainstorming/plan-writing phase untracked because it happened before this skill's process
  started — create its subtask (and start/complete it) in the same batch as everything else, or its hours
  never make it into the parent's `actual_hours` total.
- Guess whether a plan needs one parent or several — ask the operator when it's ambiguous. There is no
  delete endpoint for parent tasks, so an over-eager `pm_create_parent_task` call can't be undone.
- Close (or approve-gate) one group's parent based on the operator approving a *different* group's work
  when running multiple parents in the same session — get approval per parent, not once for all of them.
