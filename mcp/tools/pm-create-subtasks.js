// mcp/tools/pm-create-subtasks.js
import { z } from 'zod';
import { createTask, getTasks, PmApiError } from '../pm-client.js';
import { getTasksForParent, upsertTask } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

const taskInputSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  workstream: z.string().optional(),
  layer: z.string().optional(),
  assignee_id: z.string().min(1, 'assignee_id is required — call pm_list_members to find a valid user_id'),
});

function formatBatchSummary(created, skipped) {
  const lines = [];
  if (created.length) {
    lines.push(`Created ${created.length} subtask(s):`);
    for (const c of created) lines.push(`- ${c.code} (${c.id}): ${c.title}`);
  }
  if (skipped.length) {
    lines.push(`Skipped ${skipped.length} already-existing subtask(s):`);
    for (const s of skipped) lines.push(`- ${s.title} (${s.reason})`);
  }
  return lines;
}

export const pmCreateSubtasksTool = {
  name: 'pm_create_subtasks',
  description:
    'Call once you have a fixed list of tasks to track in the PM system, before starting work on any of ' +
    'them. Creates one real PM task per item under parent_task_id, skipping any that already exist ' +
    '(checked locally and against the live PM system). Every task must have an assignee_id — call ' +
    'pm_list_members first if you do not already know it; never invent one or leave it blank.',
  inputSchema: { parent_task_id: z.string(), tasks: z.array(taskInputSchema) },
  handler: async ({ parent_task_id, tasks }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);

    const missingAssignee = tasks.filter((t) => !t.assignee_id).map((t) => t.title);
    if (missingAssignee.length) {
      return {
        content: [{
          type: 'text',
          text: `Missing assignee_id for: ${missingAssignee.join(', ')}. Call pm_list_members to find a valid user_id, then retry with assignee_id set for every task.`,
        }],
        isError: true,
      };
    }

    const localTasks = getTasksForParent(cwd, parent_task_id);
    let liveTasks = null;
    const created = [];
    const skipped = [];

    try {
      for (const task of tasks) {
        if (localTasks[task.title]) {
          skipped.push({ title: task.title, reason: 'already in local state', ...localTasks[task.title] });
          continue;
        }

        if (liveTasks === null) {
          const response = await getTasks(config);
          liveTasks = response.data ?? [];
        }
        const parentEntry = liveTasks.find((t) => t.id === parent_task_id);
        const existingChild = parentEntry?.subtasks?.find((s) => s.title === task.title);
        if (existingChild) {
          const record = { id: existingChild.id, code: null, status: null };
          upsertTask(cwd, parent_task_id, task.title, record);
          skipped.push({ title: task.title, reason: 'already exists in PM system', ...record });
          continue;
        }

        const response = await createTask(config, { ...task, parent_task_id });
        const record = { id: response.data.id, code: response.data.code, status: response.data.status_code };
        upsertTask(cwd, parent_task_id, task.title, record);
        created.push({ title: task.title, ...record });
      }
    } catch (err) {
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_create_subtasks: ${err.message}`;
      const partialLines = formatBatchSummary(created, skipped);
      const text = partialLines.length
        ? `${partialLines.join('\n')}\n\nThe batch stopped after this partial progress due to an error:\n${message}`
        : message;
      return { content: [{ type: 'text', text }], isError: true };
    }

    const lines = formatBatchSummary(created, skipped);
    lines.push(
      'IMPORTANT: call pm_start_subtask(task_id) right before starting work on each of these, and pm_complete_subtask(task_id) right after it is verified done.'
    );
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};
