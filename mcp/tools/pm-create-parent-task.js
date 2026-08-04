// mcp/tools/pm-create-parent-task.js
import { z } from 'zod';
import { createTask, getTasks, PmApiError } from '../pm-client.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';
import { WORKSTREAM_VALUES, LAYER_VALUES } from '../task-fields.js';

export const pmCreateParentTaskTool = {
  name: 'pm_create_parent_task',
  description:
    'Creates a new top-level task (task cha) — no parent_task_id — that subtasks can later be created ' +
    'under via pm_create_subtasks. Skips creation and returns the existing id if a top-level task with ' +
    'the same title already exists in the PM system. Call this first when no suitable parent task exists ' +
    'yet; never call pm_create_subtasks with a fabricated parent_task_id.',
  inputSchema: {
    title: z.string(),
    description: z.string().optional(),
    workstream: z.enum(WORKSTREAM_VALUES).optional(),
    layer: z.enum(LAYER_VALUES).optional(),
    assignee_id: z.string().optional(),
  },
  handler: async ({ title, description, workstream, layer, assignee_id }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);

    try {
      const liveResponse = await getTasks(config);
      const liveTasks = liveResponse.data ?? [];
      const existing = liveTasks.find((t) => t.title === title);
      if (existing) {
        return {
          content: [{
            type: 'text',
            text: `Skipped: a top-level task named "${title}" already exists — parent_task_id=${existing.id}. ` +
              'Use this id with pm_create_subtasks.',
          }],
        };
      }

      const response = await createTask(config, { title, description, workstream, layer, assignee_id });
      const { id, code } = response.data;
      return {
        content: [{
          type: 'text',
          text: `Created parent task ${code} (${id}): ${title}. Use parent_task_id="${id}" with pm_create_subtasks to add subtasks under it.`,
        }],
      };
    } catch (err) {
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_create_parent_task: ${err.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  },
};
