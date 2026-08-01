// mcp/tool-error.js
import { PmApiError } from './pm-client.js';

export function describePmError(err) {
  if (!(err instanceof PmApiError)) throw err;
  switch (err.type) {
    case 'AUTH':
      return `PM API authentication failed: ${err.message}. This is a configuration problem — do not retry.`;
    case 'VALIDATION':
      return `PM API rejected the request: ${err.message}. Fix the offending field against the documented enums and retry once — never invent a value or drop the field.`;
    case 'CROSS_PROJECT':
      return `PM API rejected this task_id as belonging to a different project: ${err.message}. Do not retry — report the mismatch.`;
    case 'NOT_FOUND':
      return `PM API could not find the resource: ${err.message}. Re-check via get-tasks before retrying.`;
    case 'CONFLICT':
      return `PM API reports the resource already exists: ${err.message}.`;
    case 'SERVER':
      return `PM API server error persisted after one retry: ${err.message}.`;
    default:
      return `PM API error: ${err.message}`;
  }
}
