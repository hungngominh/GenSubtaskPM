// mcp/tools/pm-update-progress.js
import { z } from 'zod';
import { patchTask, PmApiError } from '../pm-client.js';
import { updateTaskById } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmUpdateProgressTool = {
  name: 'pm_update_progress',
  description:
    'Call mid-task when progress_percent, actual_hours, or status_code needs updating but the task is ' +
    'not yet fully done (use pm_complete_subtask for that). At least one field must be provided.',
  inputSchema: {
    task_id: z.string(),
    progress_percent: z.number().min(0).max(100).optional(),
    status_code: z.string().optional(),
    actual_hours: z.number().optional(),
  },
  handler: async ({ task_id, progress_percent, status_code, actual_hours }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    const payload = {};
    if (progress_percent !== undefined) payload.progress_percent = progress_percent;
    if (status_code !== undefined) payload.status_code = status_code;
    if (actual_hours !== undefined) payload.actual_hours = actual_hours;

    if (Object.keys(payload).length === 0) {
      return {
        content: [{ type: 'text', text: 'No fields provided — pass at least one of progress_percent, status_code, actual_hours.' }],
        isError: true,
      };
    }

    try {
      await patchTask(config, task_id, payload);
      if (status_code !== undefined) updateTaskById(cwd, task_id, { status: status_code });
      return { content: [{ type: 'text', text: `Updated ${task_id}: ${JSON.stringify(payload)}` }] };
    } catch (err) {
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_update_progress: ${err.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  },
};
