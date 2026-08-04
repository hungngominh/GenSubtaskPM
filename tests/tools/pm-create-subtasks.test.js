// tests/tools/pm-create-subtasks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pmCreateSubtasksTool } from '../../mcp/tools/pm-create-subtasks.js';
import { getTasksForParent } from '../../mcp/state-store.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-create-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('creates a new subtask via POST create-task when not found anywhere', () =>
  withTempDir(async (dir) => {
    let createCalls = 0;
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: [{ id: 'parent-1', subtasks: [] }] }) };
      }
      createCalls++;
      return {
        ok: true,
        status: 201,
        json: async () => ({ status: 'success', data: { id: 'child-1', code: 'TASK-0001', title: 'Do the thing', status_code: 'BACKLOG' } }),
      };
    };
    const result = await pmCreateSubtasksTool.handler(
      { parent_task_id: 'parent-1', tasks: [{ title: 'Do the thing', assignee_id: 'user-1' }] },
      { cwd: dir }
    );
    assert.equal(createCalls, 1);
    assert.match(result.content[0].text, /Created 1 subtask/);
    assert.equal(getTasksForParent(dir, 'parent-1')['Do the thing'].id, 'child-1');
  }));

test('skips creating when local state already has the task', () =>
  withTempDir(async (dir) => {
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: [{ id: 'parent-1', subtasks: [] }] }) };
      }
      return { ok: true, status: 201, json: async () => ({ status: 'success', data: { id: 'child-1', code: 'TASK-0001', status_code: 'BACKLOG' } }) };
    };
    await pmCreateSubtasksTool.handler({ parent_task_id: 'parent-1', tasks: [{ title: 'Do the thing', assignee_id: 'user-1' }] }, { cwd: dir });

    let createCalls = 0;
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) return { ok: true, status: 200, json: async () => ({ status: 'success', data: [] }) };
      createCalls++;
      throw new Error('should not be called');
    };
    const result = await pmCreateSubtasksTool.handler({ parent_task_id: 'parent-1', tasks: [{ title: 'Do the thing', assignee_id: 'user-1' }] }, { cwd: dir });
    assert.equal(createCalls, 0);
    assert.match(result.content[0].text, /Skipped 1/);
  }));

test('skips creating when get-tasks shows the child already exists in the PM system', () =>
  withTempDir(async (dir) => {
    let createCalls = 0;
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'success', data: [{ id: 'parent-1', subtasks: [{ id: 'existing-1', title: 'Do the thing' }] }] }),
        };
      }
      createCalls++;
      throw new Error('should not be called');
    };
    const result = await pmCreateSubtasksTool.handler({ parent_task_id: 'parent-1', tasks: [{ title: 'Do the thing', assignee_id: 'user-1' }] }, { cwd: dir });
    assert.equal(createCalls, 0);
    assert.match(result.content[0].text, /Skipped 1/);
    assert.equal(getTasksForParent(dir, 'parent-1')['Do the thing'].id, 'existing-1');
  }));

test('surfaces a VALIDATION error from create-task without throwing', () =>
  withTempDir(async (dir) => {
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) return { ok: true, status: 200, json: async () => ({ status: 'success', data: [] }) };
      return { ok: false, status: 400, json: async () => ({ status: 'error', message: 'title is required' }) };
    };
    const result = await pmCreateSubtasksTool.handler({ parent_task_id: 'parent-1', tasks: [{ title: 'Do the thing', assignee_id: 'user-1' }] }, { cwd: dir });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /title is required/);
  }));

test('includes a partial-progress summary when a mid-batch failure occurs', () =>
  withTempDir(async (dir) => {
    let createCalls = 0;
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: [{ id: 'parent-1', subtasks: [] }] }) };
      }
      createCalls++;
      if (createCalls === 1) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ status: 'success', data: { id: 'child-1', code: 'TASK-0001', title: 'Task One', status_code: 'BACKLOG' } }),
        };
      }
      return { ok: false, status: 400, json: async () => ({ status: 'error', message: 'title is required' }) };
    };
    const result = await pmCreateSubtasksTool.handler(
      { parent_task_id: 'parent-1', tasks: [{ title: 'Task One', assignee_id: 'user-1' }, { title: 'Task Two', assignee_id: 'user-1' }] },
      { cwd: dir }
    );
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Created 1 subtask/);
    assert.match(result.content[0].text, /Task One/);
    assert.match(result.content[0].text, /title is required/);
    assert.equal(getTasksForParent(dir, 'parent-1')['Task One'].id, 'child-1');
  }));

test('resolves with isError instead of throwing on a non-PmApiError failure', () =>
  withTempDir(async (dir) => {
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) return { ok: true, status: 200, json: async () => ({ status: 'success', data: [] }) };
      throw new TypeError('fetch failed');
    };
    try {
      const result = await pmCreateSubtasksTool.handler({ parent_task_id: 'parent-1', tasks: [{ title: 'Do the thing', assignee_id: 'user-1' }] }, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unexpected error during pm_create_subtasks/);
    } finally {
      global.fetch = originalFetch;
    }
  }));

test('creates a task with no assignee_id when the operator explicitly opts out', () =>
  withTempDir(async (dir) => {
    let createCalls = 0;
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: [{ id: 'parent-1', subtasks: [] }] }) };
      }
      createCalls++;
      return {
        ok: true,
        status: 201,
        json: async () => ({ status: 'success', data: { id: 'child-1', code: 'TASK-0001', title: 'Task Two', status_code: 'BACKLOG' } }),
      };
    };
    const result = await pmCreateSubtasksTool.handler(
      { parent_task_id: 'parent-1', tasks: [{ title: 'Task Two' }] },
      { cwd: dir }
    );
    assert.equal(createCalls, 1);
    assert.match(result.content[0].text, /Created 1 subtask/);
  }));

test('passes due_date and estimate_hours through to create-task when the operator asks for them', () =>
  withTempDir(async (dir) => {
    let sentPayload = null;
    global.fetch = async (url, opts) => {
      if (url.endsWith('/get-tasks')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: [{ id: 'parent-1', subtasks: [] }] }) };
      }
      sentPayload = JSON.parse(opts.body);
      return {
        ok: true,
        status: 201,
        json: async () => ({ status: 'success', data: { id: 'child-1', code: 'TASK-0001', title: 'Do the thing', status_code: 'BACKLOG' } }),
      };
    };
    await pmCreateSubtasksTool.handler(
      { parent_task_id: 'parent-1', tasks: [{ title: 'Do the thing', due_date: '2026-08-15', estimate_hours: 6 }] },
      { cwd: dir }
    );
    assert.equal(sentPayload.due_date, '2026-08-15');
    assert.equal(sentPayload.estimate_hours, 6);
  }));
