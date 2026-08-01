// tests/tools/pm-update-progress.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pmUpdateProgressTool } from '../../mcp/tools/pm-update-progress.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-progress-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('pm_update_progress PATCHes only the provided fields', () =>
  withTempDir(async (dir) => {
    let body;
    global.fetch = async (url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ status: 'success', data: { id: 'child-1' } }) };
    };
    await pmUpdateProgressTool.handler({ task_id: 'child-1', progress_percent: 40 }, { cwd: dir });
    assert.deepEqual(body, { progress_percent: 40 });
  }));

test('pm_update_progress rejects when no fields provided, without calling the API', () =>
  withTempDir(async (dir) => {
    let called = false;
    global.fetch = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ status: 'success', data: {} }) };
    };
    const result = await pmUpdateProgressTool.handler({ task_id: 'child-1' }, { cwd: dir });
    assert.equal(called, false);
    assert.equal(result.isError, true);
  }));

test('pm_update_progress surfaces a CROSS_PROJECT error without throwing', () =>
  withTempDir(async (dir) => {
    global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ status: 'error', message: 'wrong project' }) });
    const result = await pmUpdateProgressTool.handler({ task_id: 'child-1', progress_percent: 10 }, { cwd: dir });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /wrong project/);
  }));

test('pm_update_progress handles non-PmApiError exceptions without throwing', () =>
  withTempDir(async (dir) => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('network error');
    };
    try {
      const result = await pmUpdateProgressTool.handler({ task_id: 'child-1', progress_percent: 50 }, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unexpected error during pm_update_progress/);
    } finally {
      global.fetch = originalFetch;
    }
  }));
