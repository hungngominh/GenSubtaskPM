// tests/tools/pm-audit-status.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pmAuditStatusTool } from '../../mcp/tools/pm-audit-status.js';
import { upsertTask } from '../../mcp/state-store.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-audit-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('reports a subtask stuck in BACKLOG as never started', () =>
  withTempDir(async (dir) => {
    upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'BACKLOG' });
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: [{ id: 'parent-1', subtasks: [{ id: 'child-1', title: 'Do the thing' }] }] }),
    });
    const result = await pmAuditStatusTool.handler({ parent_task_id: 'parent-1' }, { cwd: dir });
    assert.match(result.content[0].text, /never started/);
  }));

test('reports a subtask stuck in DOING as not completed', () =>
  withTempDir(async (dir) => {
    upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'DOING' });
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: [{ id: 'parent-1', subtasks: [{ id: 'child-1', title: 'Do the thing' }] }] }),
    });
    const result = await pmAuditStatusTool.handler({ parent_task_id: 'parent-1' }, { cwd: dir });
    assert.match(result.content[0].text, /not completed/);
  }));

test('reports all-consistent when every tracked subtask is DONE', () =>
  withTempDir(async (dir) => {
    upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'DONE' });
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: [{ id: 'parent-1', subtasks: [{ id: 'child-1', title: 'Do the thing' }] }] }),
    });
    const result = await pmAuditStatusTool.handler({ parent_task_id: 'parent-1' }, { cwd: dir });
    assert.match(result.content[0].text, /consistent/);
  }));

test('reports a tracked subtask missing from the live PM system', () =>
  withTempDir(async (dir) => {
    upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'DOING' });
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: [{ id: 'parent-1', subtasks: [] }] }),
    });
    const result = await pmAuditStatusTool.handler({ parent_task_id: 'parent-1' }, { cwd: dir });
    assert.match(result.content[0].text, /not found under the parent/);
  }));

test('pm_audit_status handles non-PmApiError exceptions without throwing', () =>
  withTempDir(async (dir) => {
    upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'DOING' });
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('network error');
    };
    try {
      const result = await pmAuditStatusTool.handler({ parent_task_id: 'parent-1' }, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unexpected error during pm_audit_status/);
    } finally {
      global.fetch = originalFetch;
    }
  }));
