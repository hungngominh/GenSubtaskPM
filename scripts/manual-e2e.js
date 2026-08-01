// scripts/manual-e2e.js
// Manual verification against the real PM API. Requires PM_API_KEY (and optionally PM_API_URL) to be
// set, and a real parent_task_id passed as the first CLI argument. Not run in automated tests.
import { pmSetupTool } from '../mcp/tools/pm-setup.js';
import { pmCreateSubtasksTool } from '../mcp/tools/pm-create-subtasks.js';
import { pmStartSubtaskTool } from '../mcp/tools/pm-start-subtask.js';
import { pmCompleteSubtaskTool } from '../mcp/tools/pm-complete-subtask.js';
import { pmAuditStatusTool } from '../mcp/tools/pm-audit-status.js';

const parentTaskId = process.argv[2];
if (!parentTaskId) {
  console.error('Usage: node scripts/manual-e2e.js <parent_task_id>');
  process.exit(1);
}

function printResult(label, result) {
  console.log(`\n=== ${label} ===`);
  console.log(result.content.map((c) => c.text).join('\n'));
  if (result.isError) throw new Error(`${label} returned an error — stopping.`);
}

const cwd = process.cwd();

printResult('pm_setup', await pmSetupTool.handler({}, { cwd }));

const smokeTaskTitle = `manual-e2e smoke task ${Date.now()}`;
const createResult = await pmCreateSubtasksTool.handler(
  { parent_task_id: parentTaskId, tasks: [{ title: smokeTaskTitle }] },
  { cwd }
);
printResult('pm_create_subtasks', createResult);

const { getTasksForParent } = await import('../mcp/state-store.js');
const created = getTasksForParent(cwd, parentTaskId)[smokeTaskTitle];
if (!created) throw new Error('Could not find the freshly created task in local state.');

printResult('pm_start_subtask', await pmStartSubtaskTool.handler({ task_id: created.id }, { cwd }));
printResult('pm_complete_subtask', await pmCompleteSubtaskTool.handler({ task_id: created.id, actual_hours: 0.1 }, { cwd }));
printResult('pm_audit_status', await pmAuditStatusTool.handler({ parent_task_id: parentTaskId }, { cwd }));

console.log('\nManual e2e run completed successfully.');
