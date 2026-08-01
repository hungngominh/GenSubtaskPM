// mcp/tools/pm-start-subtask.js
import { z } from 'zod';
import { patchTask, createChecklistItems, PmApiError } from '../pm-client.js';
import { updateTaskById } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmStartSubtaskTool = {
  name: 'pm_start_subtask',
  description:
    'Call right before starting real work on a task that has a matching PM subtask — not before. ' +
    'Marks it DOING in the PM system and records a Started-at checklist entry.',
  inputSchema: { task_id: z.string() },
  handler: async ({ task_id }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    try {
      await patchTask(config, task_id, { status_code: 'DOING' });
      const startedAt = new Date().toISOString();
      await createChecklistItems(config, task_id, [{ title: 'Started at', input_type: 'TEXT', value: startedAt }]);
      updateTaskById(cwd, task_id, { status: 'DOING' });
      return { content: [{ type: 'text', text: `Marked ${task_id} as DOING (started ${startedAt}).` }] };
    } catch (err) {
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_start_subtask: ${err.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  },
};
