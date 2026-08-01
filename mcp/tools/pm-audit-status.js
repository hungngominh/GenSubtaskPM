// mcp/tools/pm-audit-status.js
import { z } from 'zod';
import { getTasks, PmApiError } from '../pm-client.js';
import { getTasksForParent } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmAuditStatusTool = {
  name: 'pm_audit_status',
  description:
    'Read-only. Cross-checks the local sync record for parent_task_id against the live PM system and ' +
    'reports any subtask whose local status looks stuck — never started, or started but never completed.',
  inputSchema: { parent_task_id: z.string() },
  handler: async ({ parent_task_id }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    const localTasks = getTasksForParent(cwd, parent_task_id);

    let liveTasks;
    try {
      const response = await getTasks(config);
      liveTasks = response.data ?? [];
    } catch (err) {
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_audit_status: ${err.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }

    const parentEntry = liveTasks.find((t) => t.id === parent_task_id);
    const liveChildIds = new Set((parentEntry?.subtasks ?? []).map((s) => s.id));

    const knownStatuses = ['BACKLOG', 'PICK', 'TODO', 'DOING', 'TESTING', 'DONE'];
    const missingLive = [];
    const neverStarted = [];
    const notCompleted = [];
    const statusUnknown = [];

    for (const [title, record] of Object.entries(localTasks)) {
      if (!liveChildIds.has(record.id)) {
        missingLive.push({ title, record });
        continue;
      }
      if (['BACKLOG', 'PICK', 'TODO'].includes(record.status)) {
        neverStarted.push({ title, record });
      } else if (['DOING', 'TESTING'].includes(record.status)) {
        notCompleted.push({ title, record });
      } else if (!knownStatuses.includes(record.status)) {
        statusUnknown.push({ title, record });
      }
    }

    const lines = [];
    if (missingLive.length) {
      lines.push(`${missingLive.length} subtask(s) tracked locally but not found under the parent in the PM system:`);
      for (const { title, record } of missingLive) lines.push(`- ${title} (${record.id})`);
    }
    if (neverStarted.length) {
      lines.push(`${neverStarted.length} subtask(s) never started (pm_start_subtask not called):`);
      for (const { title, record } of neverStarted) lines.push(`- ${title} (${record.id}): still ${record.status}`);
    }
    if (notCompleted.length) {
      lines.push(`${notCompleted.length} subtask(s) started but not completed:`);
      for (const { title, record } of notCompleted) lines.push(`- ${title} (${record.id}): still ${record.status}`);
    }
    if (statusUnknown.length) {
      lines.push(`${statusUnknown.length} subtask(s) with status unknown — verify manually:`);
      for (const { title, record } of statusUnknown) {
        lines.push(`- ${title} (${record.id}): recorded status is ${record.status === null || record.status === undefined ? 'null' : JSON.stringify(record.status)}`);
      }
    }
    if (!lines.length) lines.push('All tracked subtasks are consistent between local state and the PM system.');

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};
