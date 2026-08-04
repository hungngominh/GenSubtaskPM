// mcp/task-fields.js
export const WORKSTREAM_VALUES = ['BA', 'DEV', 'DEPLOY', 'CROSS'];
export const LAYER_VALUES = [
  'REQUIREMENT', 'FEATURE', 'ANALYSIS', 'BA', 'UI', 'API', 'DATA', 'TEST', 'SYS', 'SEC',
  'DEPLOY', 'PLAN', 'REVIEW', 'FIXBUG', 'INTERGATE', 'DOC', 'OTHER',
];
export const PRIORITY_VALUES = ['P0', 'P1', 'P2', 'P3'];
// Valid at task creation (create-task) — the PATCH endpoint accepts a wider set
// (NEED_FIX, NEED_TEST, WAITING_FIX, WAITING_TEST) that create-task does not.
export const CREATE_STATUS_CODE_VALUES = [
  'BACKLOG', 'PICK', 'TODO', 'DOING', 'TESTING', 'DONE', 'READY_DEPLOY', 'DEPLOYED', 'PENDING', 'CLOSED',
];
export const CHECKLIST_INPUT_TYPE_VALUES = ['CHECKBOX', 'TEXT', 'LINK'];
