// mcp/tools/pm-complete-subtask.js
import { z } from 'zod';
import { patchTask, getTaskDetail, createChecklistItems, PmApiError } from '../pm-client.js';
import { updateTaskById } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmCompleteSubtaskTool = {
  name: 'pm_complete_subtask',
  description:
    'Call when a task is fully done and verified (tests pass, review approved) — not merely when code is ' +
    'written. Marks it DONE at 100% progress and records a Completed-at checklist entry. actual_hours is ' +
    'REQUIRED and must be the number of hours worked SINCE the last update (a delta), never the running ' +
    'total — it is added to the task\'s existing actual_hours on the PM system, not overwritten.',
  inputSchema: {
    task_id: z.string(),
    actual_hours: z.number().min(0, 'actual_hours is required — pass the hours worked since the last update'),
  },
  handler: async ({ task_id, actual_hours }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);

    if (actual_hours === undefined || actual_hours === null) {
      return {
        content: [{
          type: 'text',
          text: 'actual_hours is required — pass the number of hours worked since the last update (it is added to the existing total, not overwritten).',
        }],
        isError: true,
      };
    }

    try {
      const detail = await getTaskDetail(config, task_id);
      const previousHours = Number(detail?.data?.actual_hours) || 0;
      const totalHours = previousHours + actual_hours;

      const patchPayload = { status_code: 'DONE', progress_percent: 100, actual_hours: totalHours };
      await patchTask(config, task_id, patchPayload);
      const completedAt = new Date().toISOString();
      await createChecklistItems(config, task_id, [{ title: 'Completed at', input_type: 'TEXT', value: completedAt }]);
      updateTaskById(cwd, task_id, { status: 'DONE' });
      return {
        content: [{
          type: 'text',
          text: `Marked ${task_id} as DONE (completed ${completedAt}, added ${actual_hours}h to previous ${previousHours}h for a total of ${totalHours}h).`,
        }],
      };
    } catch (err) {
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_complete_subtask: ${err.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  },
};
