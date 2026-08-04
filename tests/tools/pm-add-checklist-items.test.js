// tests/tools/pm-add-checklist-items.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pmAddChecklistItemsTool } from '../../mcp/tools/pm-add-checklist-items.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-add-checklist-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('pm_add_checklist_items posts items and reports how many were created', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    let sentBody = null;
    global.fetch = async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          status: 'success',
          data: [{ id: 'ci1', title: 'Verify response headers' }, { id: 'ci2', title: 'Write unit tests' }],
        }),
      };
    };
    try {
      const result = await pmAddChecklistItemsTool.handler(
        {
          task_id: 't1',
          items: [{ title: 'Verify response headers', order_no: 1 }, { title: 'Write unit tests', order_no: 2 }],
        },
        { cwd: dir }
      );
      assert.equal(sentBody.items.length, 2);
      assert.match(result.content[0].text, /Added 2 checklist item\(s\) to t1/);
      assert.match(result.content[0].text, /Verify response headers/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));

test('pm_add_checklist_items surfaces a VALIDATION error without throwing', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ status: 'error', message: 'title is required' }),
    });
    try {
      const result = await pmAddChecklistItemsTool.handler({ task_id: 't1', items: [{ title: '' }] }, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /title is required/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));

test('pm_add_checklist_items resolves with isError instead of throwing on a non-PmApiError failure', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    try {
      const result = await pmAddChecklistItemsTool.handler({ task_id: 't1', items: [{ title: 'x' }] }, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unexpected error during pm_add_checklist_items/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));
