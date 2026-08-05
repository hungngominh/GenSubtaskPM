// tests/tools/pm-start-complete-subtask.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pmStartSubtaskTool } from '../../mcp/tools/pm-start-subtask.js';
import { pmCompleteSubtaskTool } from '../../mcp/tools/pm-complete-subtask.js';
import { upsertTask, getTasksForParent } from '../../mcp/state-store.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-lifecycle-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('pm_start_subtask PATCHes DOING and posts a Started-at checklist item', () =>
  withTempDir(async (dir) => {
    upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'BACKLOG' });
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
      if (url.endsWith('/tasks/child-1')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: { id: 'child-1', status_code: 'DOING' } }) };
      }
      return { ok: true, status: 201, json: async () => ({ status: 'success', data: [] }) };
    };
    await pmStartSubtaskTool.handler({ task_id: 'child-1' }, { cwd: dir });

    assert.equal(calls[0].body.status_code, 'DOING');
    assert.equal(calls[1].body.items[0].title, 'Started at');
    assert.equal(calls[1].body.items[0].input_type, 'TEXT');
    assert.equal(getTasksForParent(dir, 'parent-1')['Do the thing'].status, 'DOING');
  }));

test('pm_complete_subtask PATCHes DONE/100 with accumulated actual_hours and posts a Completed-at checklist item', () =>
  withTempDir(async (dir) => {
    upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'DOING' });
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
      if (url.endsWith('/get-task/child-1')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: { id: 'child-1', actual_hours: '4.00' } }) };
      }
      if (url.endsWith('/tasks/child-1')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: { id: 'child-1', status_code: 'DONE' } }) };
      }
      return { ok: true, status: 201, json: async () => ({ status: 'success', data: [] }) };
    };
    await pmCompleteSubtaskTool.handler({ task_id: 'child-1', actual_hours: 3.5 }, { cwd: dir });

    const patchCall = calls.find((c) => c.url.endsWith('/tasks/child-1'));
    assert.deepEqual(patchCall.body, { status_code: 'DONE', progress_percent: 100, actual_hours: 7.5 });
    const checklistCall = calls.find((c) => c.body?.items);
    assert.equal(checklistCall.body.items[0].title, 'Completed at');
    assert.equal(getTasksForParent(dir, 'parent-1')['Do the thing'].status, 'DONE');
  }));

test('pm_complete_subtask numerically adds actual_hours even when the API returns it as a decimal string', () =>
  withTempDir(async (dir) => {
    upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'DOING' });
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
      if (url.endsWith('/get-task/child-1')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: { id: 'child-1', actual_hours: '0.50' } }) };
      }
      if (url.endsWith('/tasks/child-1')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: { id: 'child-1', status_code: 'DONE' } }) };
      }
      return { ok: true, status: 201, json: async () => ({ status: 'success', data: [] }) };
    };
    await pmCompleteSubtaskTool.handler({ task_id: 'child-1', actual_hours: 1.5 }, { cwd: dir });

    const patchCall = calls.find((c) => c.url.endsWith('/tasks/child-1'));
    assert.deepEqual(patchCall.body, { status_code: 'DONE', progress_percent: 100, actual_hours: 2 });
  }));

test('pm_complete_subtask rejects when actual_hours is missing, without calling the API', () =>
  withTempDir(async (dir) => {
    let called = false;
    global.fetch = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ status: 'success', data: {} }) };
    };
    const result = await pmCompleteSubtaskTool.handler({ task_id: 'child-1' }, { cwd: dir });
    assert.equal(called, false);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /actual_hours is required/);
  }));

test('pm_start_subtask surfaces a NOT_FOUND error without throwing', () =>
  withTempDir(async (dir) => {
    global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ status: 'error', message: 'task not found' }) });
    const result = await pmStartSubtaskTool.handler({ task_id: 'missing' }, { cwd: dir });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /task not found/);
  }));

test('pm_start_subtask handles non-PmApiError exceptions without throwing', () =>
  withTempDir(async (dir) => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('network error');
    };
    try {
      const result = await pmStartSubtaskTool.handler({ task_id: 'child-1' }, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unexpected error during pm_start_subtask/);
    } finally {
      global.fetch = originalFetch;
    }
  }));

test('pm_complete_subtask handles non-PmApiError exceptions without throwing', () =>
  withTempDir(async (dir) => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('network error');
    };
    try {
      const result = await pmCompleteSubtaskTool.handler({ task_id: 'child-1', actual_hours: 2.5 }, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unexpected error during pm_complete_subtask/);
    } finally {
      global.fetch = originalFetch;
    }
  }));
