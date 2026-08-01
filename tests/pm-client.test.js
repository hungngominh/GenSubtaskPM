// tests/pm-client.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask, patchTask, PmApiError } from '../mcp/pm-client.js';

function mockFetchSequence(responses) {
  let i = 0;
  global.fetch = async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
}

const config = { baseUrl: 'https://example.test', apiKey: 'key-123' };

test('createTask returns parsed data on 201', async () => {
  mockFetchSequence([{ status: 201, body: { status: 'success', data: { id: 'abc', code: 'TASK-1' } } }]);
  const result = await createTask(config, { title: 'X' });
  assert.equal(result.data.id, 'abc');
});

test('createTask throws PmApiError type VALIDATION on 400, no retry', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: false, status: 400, json: async () => ({ status: 'error', message: 'title is required' }) };
  };
  await assert.rejects(
    () => createTask(config, {}),
    (err) => err instanceof PmApiError && err.type === 'VALIDATION' && err.message === 'title is required'
  );
  assert.equal(calls, 1);
});

test('patchTask throws PmApiError type AUTH on 401, no retry', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: false, status: 401, json: async () => ({ status: 'error', code: 'INVALID_API_KEY', message: 'bad key' }) };
  };
  await assert.rejects(() => patchTask(config, 't1', { status_code: 'DOING' }), (err) => err.type === 'AUTH');
  assert.equal(calls, 1);
});

test('createTask retries once on 500 then succeeds', async () => {
  mockFetchSequence([
    { status: 500, body: { status: 'error', message: 'boom' } },
    { status: 201, body: { status: 'success', data: { id: 'abc' } } },
  ]);
  const result = await createTask(config, { title: 'X' });
  assert.equal(result.data.id, 'abc');
});

test('createTask stops after one retry if 500 persists', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: false, status: 500, json: async () => ({ status: 'error', message: 'still broken' }) };
  };
  await assert.rejects(() => createTask(config, { title: 'X' }), (err) => err.type === 'SERVER');
  assert.equal(calls, 2);
});

test('createTask classifies 403 as CROSS_PROJECT and 404 as NOT_FOUND and 409 as CONFLICT', async () => {
  for (const [status, type] of [[403, 'CROSS_PROJECT'], [404, 'NOT_FOUND'], [409, 'CONFLICT']]) {
    global.fetch = async () => ({ ok: false, status, json: async () => ({ status: 'error', message: `err-${status}` }) });
    await assert.rejects(() => createTask(config, { title: 'X' }), (err) => err.type === type);
  }
});
