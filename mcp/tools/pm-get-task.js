// mcp/tools/pm-get-task.js
import { z } from 'zod';
import { getTaskDetail, PmApiError } from '../pm-client.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmGetTaskTool = {
  name: 'pm_get_task',
  description:
    'Read-only. Fetches the full current detail of a single task by id — status, assignee, progress, ' +
    'hours, parent/feature/requirement links. Call this before starting work that depends on another ' +
    'task, rather than assuming its current state.',
  inputSchema: { task_id: z.string() },
  handler: async ({ task_id }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    try {
      const response = await getTaskDetail(config, task_id);
      const t = response?.data;
      if (!t) {
        return { content: [{ type: 'text', text: `No detail returned for task ${task_id}.` }], isError: true };
      }
      const lines = [
        `${t.code ?? t.id}: ${t.title}`,
        `status: ${t.status_code ?? t.status_label ?? 'unknown'}`,
        `assignee: ${t.assignee_name ?? 'unassigned'}${t.assignee_id ? ` (${t.assignee_id})` : ''}`,
        `workstream/layer: ${t.workstream ?? '-'} / ${t.layer ?? '-'}`,
        `priority: ${t.priority ?? '-'}`,
        `progress: ${t.progress_percent ?? 0}% — actual_hours: ${t.actual_hours ?? 0} / estimate_hours: ${t.estimate_hours ?? '-'}`,
        `due_date: ${t.due_date ?? '-'}`,
        `parent_task: ${t.parent_task_title ? `${t.parent_task_title} (${t.parent_task_id})` : 'none'}`,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_get_task: ${err.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  },
};
