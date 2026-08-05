// mcp/tools/pm-update-progress.js
import { z } from 'zod';
import { patchTask, getTaskDetail, PmApiError } from '../pm-client.js';
import { updateTaskById } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmUpdateProgressTool = {
  name: 'pm_update_progress',
  description:
    'Call mid-task to update progress_percent and/or status_code, and to log hours worked. actual_hours ' +
    'is REQUIRED and must be the number of hours worked SINCE the last update (a delta), never the running ' +
    'total — it is added to the task\'s existing actual_hours on the PM system, not overwritten.',
  inputSchema: {
    task_id: z.string(),
    progress_percent: z.number().min(0).max(100).optional(),
    status_code: z.string().optional(),
    actual_hours: z.number().min(0, 'actual_hours is required — pass the hours worked since the last update'),
  },
  handler: async ({ task_id, progress_percent, status_code, actual_hours }, ctx = {}) => {
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

      const payload = { actual_hours: totalHours };
      if (progress_percent !== undefined) payload.progress_percent = progress_percent;
      if (status_code !== undefined) payload.status_code = status_code;

      await patchTask(config, task_id, payload);
      if (status_code !== undefined) updateTaskById(cwd, task_id, { status: status_code });
      return {
        content: [{
          type: 'text',
          text: `Updated ${task_id}: ${JSON.stringify(payload)} (added ${actual_hours}h to previous ${previousHours}h).`,
        }],
      };
    } catch (err) {
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_update_progress: ${err.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  },
};
