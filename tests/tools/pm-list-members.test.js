// tests/tools/pm-list-members.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pmListMembersTool } from '../../mcp/tools/pm-list-members.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-list-members-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('pm_list_members formats each member with user_id and roles', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: [
          { user_id: 'u1', full_name: 'John Doe', email: 'john@example.com', roles: ['DEV', 'DEV_LEAD'] },
        ],
      }),
    });
    try {
      const result = await pmListMembersTool.handler({}, { cwd: dir });
      assert.match(result.content[0].text, /John Doe/);
      assert.match(result.content[0].text, /john@example\.com/);
      assert.match(result.content[0].text, /u1/);
      assert.match(result.content[0].text, /DEV, DEV_LEAD/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));

test('pm_list_members reports an empty project with no error', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ status: 'success', data: [] }) });
    try {
      const result = await pmListMembersTool.handler({}, { cwd: dir });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /no members/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));

test('pm_list_members resolves with isError on API failure instead of throwing', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ status: 'error', code: 'INVALID_API_KEY', message: 'Key not found' }),
    });
    try {
      const result = await pmListMembersTool.handler({}, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /authentication failed/i);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));

test('pm_list_members resolves with isError instead of throwing on a non-PmApiError failure', () =>
  withTempDir(async (dir) => {
    process.env.PM_API_KEY = 'test-key';
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    try {
      const result = await pmListMembersTool.handler({}, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unexpected error during pm_list_members/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.PM_API_KEY;
    }
  }));
