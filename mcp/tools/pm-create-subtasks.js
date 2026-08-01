// mcp/tools/pm-create-subtasks.js
import { z } from 'zod';
import { createTask, getTasks } from '../pm-client.js';
import { getTasksForParent, upsertTask } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

const taskInputSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  workstream: z.string().optional(),
  layer: z.string().optional(),
  assignee_id: z.string().optional(),
});

export const pmCreateSubtasksTool = {
  name: 'pm_create_subtasks',
  description:
    'Call once you have a fixed list of tasks to track in the PM system, before starting work on any of ' +
    'them. Creates one real PM task per item under parent_task_id, skipping any that already exist ' +
    '(checked locally and against the live PM system).',
  inputSchema: { parent_task_id: z.string(), tasks: z.array(taskInputSchema) },
  handler: async ({ parent_task_id, tasks }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
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
      return { content: [{ type: 'text', text: describePmError(err) }], isError: true };
    }

    const lines = [];
    if (created.length) {
      lines.push(`Created ${created.length} subtask(s):`);
      for (const c of created) lines.push(`- ${c.code} (${c.id}): ${c.title}`);
    }
    if (skipped.length) {
      lines.push(`Skipped ${skipped.length} already-existing subtask(s):`);
      for (const s of skipped) lines.push(`- ${s.title} (${s.reason})`);
    }
    lines.push(
      'IMPORTANT: call pm_start_subtask(task_id) right before starting work on each of these, and pm_complete_subtask(task_id) right after it is verified done.'
    );
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};
