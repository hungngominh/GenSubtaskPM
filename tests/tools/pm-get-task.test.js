// tests/tools/pm-get-task.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pmGetTaskTool } from '../../mcp/tools/pm-get-task.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-get-task-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('pm_get_task formats the task detail', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: {
          id: 't1', code: 'TASK-0021', title: 'Build API', status_code: 'DOING',
          assignee_name: 'John Doe', assignee_id: 'u1', workstream: 'DEV', layer: 'API',
          priority: 'P1', progress_percent: 40, actual_hours: 3, estimate_hours: 8,
          due_date: '2026-08-15', parent_task_id: null, parent_task_title: null,
        },
      }),
    });
    try {
      const result = await pmGetTaskTool.handler({ task_id: 't1' }, { cwd: dir });
      assert.match(result.content[0].text, /TASK-0021: Build API/);
      assert.match(result.content[0].text, /status: DOING/);
      assert.match(result.content[0].text, /John Doe \(u1\)/);
      assert.match(result.content[0].text, /progress: 40%/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));

test('pm_get_task resolves with isError on a NOT_FOUND response', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({ status: 'error', message: 'Task not found' }),
    });
    try {
      const result = await pmGetTaskTool.handler({ task_id: 'missing' }, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /could not find the resource/i);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));

test('pm_get_task resolves with isError instead of throwing on a non-PmApiError failure', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    try {
      const result = await pmGetTaskTool.handler({ task_id: 't1' }, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unexpected error during pm_get_task/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));
