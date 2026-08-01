// mcp/tools/pm-complete-subtask.js
import { z } from 'zod';
import { patchTask, createChecklistItems, PmApiError } from '../pm-client.js';
import { updateTaskById } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmCompleteSubtaskTool = {
  name: 'pm_complete_subtask',
  description:
    'Call when a task is fully done and verified (tests pass, review approved) — not merely when code is ' +
    'written. Marks it DONE at 100% progress and records a Completed-at checklist entry.',
  inputSchema: { task_id: z.string(), actual_hours: z.number().optional() },
  handler: async ({ task_id, actual_hours }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    try {
      const patchPayload = { status_code: 'DONE', progress_percent: 100 };
      if (actual_hours !== undefined) patchPayload.actual_hours = actual_hours;
      await patchTask(config, task_id, patchPayload);
      const completedAt = new Date().toISOString();
      await createChecklistItems(config, task_id, [{ title: 'Completed at', input_type: 'TEXT', value: completedAt }]);
      updateTaskById(cwd, task_id, { status: 'DONE' });
      return { content: [{ type: 'text', text: `Marked ${task_id} as DONE (completed ${completedAt}).` }] };
    } catch (err) {
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_complete_subtask: ${err.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  },
};
