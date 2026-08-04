// tests/tools/pm-list-tasks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pmListTasksTool } from '../../mcp/tools/pm-list-tasks.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-list-tasks-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('pm_list_tasks formats each task with status and subtasks', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: [
          { id: 'p1', title: 'Epic One', status: 'DOING', subtasks: [{ id: 'c1', title: 'Child A' }] },
          { id: 'p2', title: 'Epic Two', status: 'BACKLOG', subtasks: [] },
        ],
      }),
    });
    try {
      const result = await pmListTasksTool.handler({}, { cwd: dir });
      assert.match(result.content[0].text, /Epic One \(p1\) \[DOING\] — subtasks: Child A/);
      assert.match(result.content[0].text, /Epic Two \(p2\) \[BACKLOG\]/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));

test('pm_list_tasks reports an empty project with no error', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ status: 'success', data: [] }) });
    try {
      const result = await pmListTasksTool.handler({}, { cwd: dir });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /no active tasks/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));

test('pm_list_tasks resolves with isError instead of throwing on a non-PmApiError failure', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    try {
      const result = await pmListTasksTool.handler({}, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unexpected error during pm_list_tasks/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));
