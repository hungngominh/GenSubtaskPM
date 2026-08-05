// mcp/tools/pm-add-checklist-items.js
import { z } from 'zod';
import { createChecklistItems, PmApiError } from '../pm-client.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';
import { CHECKLIST_INPUT_TYPE_VALUES } from '../task-fields.js';

const checklistItemSchema = z.object({
  title: z.string(),
  description: z.string().optional()
    .describe('Checklist item description. Supports Markdown — format as proper Markdown before sending.'),
  input_type: z.enum(CHECKLIST_INPUT_TYPE_VALUES).optional(),
  value: z.string().optional(),
  is_done: z.boolean().optional(),
  order_no: z.number().optional(),
});

export const pmAddChecklistItemsTool = {
  name: 'pm_add_checklist_items',
  description:
    'Adds one or more checklist items to an existing task — lightweight sub-steps or verification items ' +
    'that do not need their own status/assignee. There is no separate get/update/delete for checklist items ' +
    '(creation only, per the PM API), so double-check the list before calling. For real sub-tasks that need ' +
    'their own status/assignee, use pm_create_subtasks instead.',
  inputSchema: { task_id: z.string(), items: z.array(checklistItemSchema).min(1) },
  handler: async ({ task_id, items }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    try {
      const response = await createChecklistItems(config, task_id, items);
      const created = response?.data ?? [];
      const lines = [`Added ${created.length} checklist item(s) to ${task_id}:`];
      for (const c of created) lines.push(`- ${c.title}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_add_checklist_items: ${err.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  },
};
