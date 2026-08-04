// mcp/tools/pm-list-tasks.js
import { getTasks, PmApiError } from '../pm-client.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmListTasksTool = {
  name: 'pm_list_tasks',
  description:
    'Read-only. Lists all active top-level tasks in the current project (up to 1000, no filtering/pagination ' +
    '— the underlying API has none), each with its id, status, and direct subtask titles. Use this to browse ' +
    'the project or find a parent_task_id/task_id by title instead of guessing one.',
  inputSchema: {},
  handler: async (_args, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    try {
      const response = await getTasks(config);
      const tasks = response?.data ?? [];
      if (!tasks.length) {
        return { content: [{ type: 'text', text: 'This project has no active tasks.' }] };
      }
      const lines = tasks.map((t) => {
        const subtaskPart = t.subtasks?.length
          ? ` — subtasks: ${t.subtasks.map((s) => s.title).join(', ')}`
          : '';
        return `- ${t.title} (${t.id}) [${t.status ?? t.status_code ?? 'unknown'}]${subtaskPart}`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_list_tasks: ${err.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  },
};
