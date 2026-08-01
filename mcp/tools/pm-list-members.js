// mcp/tools/pm-list-members.js
import { getMembers, PmApiError } from '../pm-client.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmListMembersTool = {
  name: 'pm_list_members',
  description:
    'Lists the current project\'s members with their user_id and roles. Call this before ' +
    'pm_create_subtasks whenever a subtask needs an assignee_id — never guess a user_id.',
  inputSchema: {},
  handler: async (_args, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    try {
      const result = await getMembers(config);
      const members = result?.data || [];
      if (!members.length) {
        return { content: [{ type: 'text', text: 'This project has no members.' }] };
      }
      const lines = members.map(
        (m) => `- ${m.full_name} (${m.email}) — user_id: ${m.user_id} — roles: ${(m.roles || []).join(', ') || 'none'}`
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_list_members: ${err.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  },
};
