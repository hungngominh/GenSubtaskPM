// tests/tools/pm-setup.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pmSetupTool } from '../../mcp/tools/pm-setup.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-setup-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('pm_setup reports missing key when none available', () =>
  withTempDir(async (dir) => {
    const originalKey = process.env.PM_API_KEY;
    delete process.env.PM_API_KEY;
    try {
      const result = await pmSetupTool.handler({}, { cwd: dir });
      assert.match(result.content[0].text, /No PM_API_KEY found/);
    } finally {
      if (originalKey !== undefined) process.env.PM_API_KEY = originalKey;
    }
  }));

test('pm_setup validates a new key and persists it on success', () =>
  withTempDir(async (dir) => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: { name: 'Acme Project', customer_name: 'Acme Corp' } }),
    });
    try {
      const result = await pmSetupTool.handler({ api_key: 'new-key' }, { cwd: dir });
      assert.match(result.content[0].text, /Acme Project/);
      assert.match(result.content[0].text, /Acme Corp/);
      assert.equal(existsSync(join(dir, '.pm-sync-config.json')), true);
    } finally {
      global.fetch = originalFetch;
    }
  }));

test('pm_setup reports an invalid key without persisting it', () =>
  withTempDir(async (dir) => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ status: 'error', code: 'INVALID_API_KEY', message: 'Key not found' }),
    });
    try {
      const result = await pmSetupTool.handler({ api_key: 'bad-key' }, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /authentication failed/i);
      assert.equal(existsSync(join(dir, '.pm-sync-config.json')), false);
    } finally {
      global.fetch = originalFetch;
    }
  }));

test('pm_setup resolves with isError instead of throwing on a non-PmApiError failure', () =>
  withTempDir(async (dir) => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    try {
      const result = await pmSetupTool.handler({ api_key: 'new-key' }, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unexpected error during pm_setup/);
      assert.equal(existsSync(join(dir, '.pm-sync-config.json')), false);
    } finally {
      global.fetch = originalFetch;
    }
  }));
