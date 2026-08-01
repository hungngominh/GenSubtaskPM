# MCP-GenSubTask — PM Subtask Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an MCP server exposing 6 tools that wrap the Alliance ITSC PM system's bot-agents API, plus a companion skill (`pm-synced-development`) that calls those tools at the right points in a subagent-driven task loop.

**Architecture:** Plain Node.js (ESM, no build step, no TypeScript) using the official `@modelcontextprotocol/sdk` with `McpServer` + `StdioServerTransport`, Zod for input validation, and the built-in `fetch`. A thin layered structure — `config.js` (env/credential resolution) → `pm-client.js` (HTTP + error classification) → `state-store.js` (local JSON dedup/audit state) → one file per tool under `mcp/tools/` → `server.js` (wiring). A separate `skills/pm-synced-development/SKILL.md` is the only integration point with superpowers; no superpowers files are read or modified.

**Tech Stack:** Node.js ≥ 18 (for built-in `fetch` and `node:test`), `@modelcontextprotocol/sdk`, `zod`. Test runner: Node's built-in `node:test` + `node:assert/strict` — no extra test dependency.

## Global Constraints

- Node.js ≥ 18, ESM only (`"type": "module"` in package.json) — no TypeScript, no bundler/build step.
- Env vars: `PM_API_URL` (default `https://pm-api.allianceitsc.com` if unset) and `PM_API_KEY` (no default — resolution falls back to a local `.pm-sync-config.json`, then to asking the user via `pm_setup`).
- All PM API requests: base path `/v1/bot-agents`, header `x-api-key: <key>`, `Content-Type: application/json`.
- Retry policy (per spec §5 / `bot_tasks.md` §4): automatic retry exactly once, only for `5xx` responses, after a short backoff. Never auto-retry `400/401/403/404/409` — those are classified and surfaced to the caller (the LLM), which decides whether/how to retry.
- The `message` field from any PM API error response must always reach the caller — never swallowed.
- MCP tool handlers must never throw — always return `{ content: [...] }`, using `isError: true` for failures (per MCP SDK convention). Never write to stdout outside the MCP transport itself — logs go to stderr only.
- `.pm-sync-state.json` and `.pm-sync-config.json` (both live in the calling project's cwd, not this plugin's directory) must be gitignored.
- No code in this plugin reads, writes, or depends on files belonging to the superpowers plugin or any other plugin.
- Out of scope (per spec §7): editing task fields beyond `status_code`/`actual_hours`/`progress_percent`; deleting tasks/checklist items; assignee (`get-members`) resolution.

---

### Task 1: Project scaffolding + config resolution

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.claude-plugin/plugin.json`
- Create: `.mcp.json`
- Create: `mcp/config.js`
- Test: `tests/config.test.js`

**Interfaces:**
- Produces: `resolveConfig(cwd = process.cwd()) -> { baseUrl: string, apiKey: string|null }`, `readStoredApiKey(cwd) -> string|null`, `persistApiKey(apiKey, cwd) -> void` — used by every tool module in later tasks.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mcp-gensubtask",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "MCP server for creating and syncing subtasks with the Alliance ITSC PM system.",
  "main": "mcp/server.js",
  "scripts": {
    "start": "node mcp/server.js",
    "test": "node --test tests/"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.pm-sync-state.json
.pm-sync-config.json
```

- [ ] **Step 3: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "pm-gensubtask",
  "description": "Creates and syncs subtasks with the Alliance ITSC PM system while implementation work happens locally.",
  "version": "0.1.0"
}
```

- [ ] **Step 4: Create `.mcp.json`**

```json
{
  "pm-gensubtask": {
    "command": "node",
    "args": ["mcp/server.js"]
  }
}
```

- [ ] **Step 5: Run `npm install`**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` written, no errors.

- [ ] **Step 6: Write the failing tests for config resolution**

```js
// tests/config.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig, persistApiKey, readStoredApiKey } from '../mcp/config.js';

test('resolveConfig defaults to Alliance base URL when PM_API_URL unset', () => {
  const original = process.env.PM_API_URL;
  delete process.env.PM_API_URL;
  const dir = mkdtempSync(join(tmpdir(), 'pm-config-'));
  try {
    const { baseUrl } = resolveConfig(dir);
    assert.equal(baseUrl, 'https://pm-api.allianceitsc.com');
  } finally {
    if (original !== undefined) process.env.PM_API_URL = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveConfig prefers PM_API_KEY env var over stored file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-config-'));
  persistApiKey('stored-key', dir);
  const originalKey = process.env.PM_API_KEY;
  process.env.PM_API_KEY = 'env-key';
  try {
    const { apiKey } = resolveConfig(dir);
    assert.equal(apiKey, 'env-key');
  } finally {
    if (originalKey !== undefined) process.env.PM_API_KEY = originalKey; else delete process.env.PM_API_KEY;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveConfig falls back to stored config file when env var unset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-config-'));
  persistApiKey('stored-key', dir);
  const originalKey = process.env.PM_API_KEY;
  delete process.env.PM_API_KEY;
  try {
    const { apiKey } = resolveConfig(dir);
    assert.equal(apiKey, 'stored-key');
  } finally {
    if (originalKey !== undefined) process.env.PM_API_KEY = originalKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveConfig returns null apiKey when nothing set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-config-'));
  const originalKey = process.env.PM_API_KEY;
  delete process.env.PM_API_KEY;
  try {
    const { apiKey } = resolveConfig(dir);
    assert.equal(apiKey, null);
  } finally {
    if (originalKey !== undefined) process.env.PM_API_KEY = originalKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readStoredApiKey returns null when no config file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-config-'));
  try {
    assert.equal(readStoredApiKey(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `mcp/config.js` does not exist yet (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 8: Implement `mcp/config.js`**

```js
// mcp/config.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_BASE_URL = 'https://pm-api.allianceitsc.com';
const CONFIG_FILE_NAME = '.pm-sync-config.json';

export function resolveConfig(cwd = process.cwd()) {
  const baseUrl = process.env.PM_API_URL || DEFAULT_BASE_URL;
  const apiKey = process.env.PM_API_KEY || readStoredApiKey(cwd);
  return { baseUrl, apiKey };
}

export function readStoredApiKey(cwd = process.cwd()) {
  const filePath = join(cwd, CONFIG_FILE_NAME);
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    return data.apiKey || null;
  } catch {
    return null;
  }
}

export function persistApiKey(apiKey, cwd = process.cwd()) {
  const filePath = join(cwd, CONFIG_FILE_NAME);
  writeFileSync(filePath, JSON.stringify({ apiKey }, null, 2), 'utf-8');
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 5 tests green.

- [ ] **Step 10: Commit**

```bash
git init
git add package.json .gitignore .claude-plugin/plugin.json .mcp.json mcp/config.js tests/config.test.js package-lock.json
git commit -m "feat: scaffold plugin and add PM config resolution"
```

---

### Task 2: PM API client + error classification

**Files:**
- Create: `mcp/pm-client.js`
- Create: `mcp/tool-error.js`
- Test: `tests/pm-client.test.js`

**Interfaces:**
- Consumes: `resolveConfig` result shape `{ baseUrl, apiKey }` from Task 1 (config objects are passed straight into every client function).
- Produces: `PmApiError` (class, fields `status`, `code`, `type`, `message`, `details`), `getProjectInfoMini(config)`, `createTask(config, payload)`, `getTasks(config)`, `getTaskDetail(config, taskId)`, `patchTask(config, taskId, payload)`, `createChecklistItems(config, taskId, items)` — all `async`, all resolve to the parsed JSON body. Also `describePmError(err) -> string` from `mcp/tool-error.js`, used by every tool handler from Task 4 onward to turn a caught `PmApiError` into caller-facing text.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `mcp/pm-client.js` does not exist yet.

- [ ] **Step 3: Implement `mcp/pm-client.js`**

```js
// mcp/pm-client.js

export class PmApiError extends Error {
  constructor({ status, code, message, type, details }) {
    super(message);
    this.name = 'PmApiError';
    this.status = status;
    this.code = code;
    this.type = type;
    this.details = details;
  }
}

function classify(status, body) {
  const message = body?.message || `Request failed with status ${status}`;
  const code = body?.code;
  const types = { 400: 'VALIDATION', 401: 'AUTH', 403: 'CROSS_PROJECT', 404: 'NOT_FOUND', 409: 'CONFLICT' };
  const type = types[status] || (status >= 500 ? 'SERVER' : 'UNKNOWN');
  return new PmApiError({ status, code, message, type, details: body });
}

async function rawRequest(config, method, path, body) {
  const res = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) throw classify(res.status, parsed);
  return parsed;
}

async function request(config, method, path, body) {
  try {
    return await rawRequest(config, method, path, body);
  } catch (err) {
    if (err instanceof PmApiError && err.type === 'SERVER') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return rawRequest(config, method, path, body);
    }
    throw err;
  }
}

export async function getProjectInfoMini(config) {
  return request(config, 'GET', '/v1/bot-agents/project-info-mini');
}

export async function createTask(config, payload) {
  return request(config, 'POST', '/v1/bot-agents/create-task', payload);
}

export async function getTasks(config) {
  return request(config, 'GET', '/v1/bot-agents/get-tasks');
}

export async function getTaskDetail(config, taskId) {
  return request(config, 'GET', `/v1/bot-agents/get-task/${taskId}`);
}

export async function patchTask(config, taskId, payload) {
  return request(config, 'PATCH', `/v1/bot-agents/tasks/${taskId}`, payload);
}

export async function createChecklistItems(config, taskId, items) {
  return request(config, 'POST', `/v1/bot-agents/tasks/${taskId}/checklists`, { items });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Implement `mcp/tool-error.js`**

No test file for this step — it is a pure string-formatting helper exercised indirectly by every tool test from Task 4 onward (each of those tests asserts on the text a real `PmApiError` produces through this function).

```js
// mcp/tool-error.js
import { PmApiError } from './pm-client.js';

export function describePmError(err) {
  if (!(err instanceof PmApiError)) throw err;
  switch (err.type) {
    case 'AUTH':
      return `PM API authentication failed: ${err.message}. This is a configuration problem — do not retry.`;
    case 'VALIDATION':
      return `PM API rejected the request: ${err.message}. Fix the offending field against the documented enums and retry once — never invent a value or drop the field.`;
    case 'CROSS_PROJECT':
      return `PM API rejected this task_id as belonging to a different project: ${err.message}. Do not retry — report the mismatch.`;
    case 'NOT_FOUND':
      return `PM API could not find the resource: ${err.message}. Re-check via get-tasks before retrying.`;
    case 'CONFLICT':
      return `PM API reports the resource already exists: ${err.message}.`;
    case 'SERVER':
      return `PM API server error persisted after one retry: ${err.message}.`;
    default:
      return `PM API error: ${err.message}`;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add mcp/pm-client.js mcp/tool-error.js tests/pm-client.test.js
git commit -m "feat: add PM API client with error classification"
```

---

### Task 3: Local state store

**Files:**
- Create: `mcp/state-store.js`
- Test: `tests/state-store.test.js`

**Interfaces:**
- Produces: `loadState(cwd)`, `upsertTask(cwd, parentTaskId, title, record) -> record`, `getTasksForParent(cwd, parentTaskId) -> object`, `findTaskById(cwd, taskId) -> {parentTaskId, title, record}|null`, `updateTaskById(cwd, taskId, patch) -> record|null` — used by every tool from Task 5 onward. `record` shape: `{ id, code, status }`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/state-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, upsertTask, getTasksForParent, findTaskById, updateTaskById } from '../mcp/state-store.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-state-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('loadState returns {} when no file exists', () => {
  withTempDir((dir) => {
    assert.deepEqual(loadState(dir), {});
  });
});

test('upsertTask creates a new parent entry and persists to disk', () => {
  withTempDir((dir) => {
    const record = upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'BACKLOG' });
    assert.equal(record.id, 'child-1');
    assert.deepEqual(loadState(dir), { 'parent-1': { tasks: { 'Do the thing': { id: 'child-1', code: 'TASK-0001', status: 'BACKLOG' } } } });
  });
});

test('upsertTask merges into an existing record rather than replacing it', () => {
  withTempDir((dir) => {
    upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'BACKLOG' });
    upsertTask(dir, 'parent-1', 'Do the thing', { status: 'DOING' });
    const tasks = getTasksForParent(dir, 'parent-1');
    assert.deepEqual(tasks['Do the thing'], { id: 'child-1', code: 'TASK-0001', status: 'DOING' });
  });
});

test('getTasksForParent returns {} for an unknown parent', () => {
  withTempDir((dir) => {
    assert.deepEqual(getTasksForParent(dir, 'nope'), {});
  });
});

test('findTaskById scans across parents and titles by record id', () => {
  withTempDir((dir) => {
    upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'BACKLOG' });
    upsertTask(dir, 'parent-2', 'Other thing', { id: 'child-2', code: 'TASK-0002', status: 'BACKLOG' });
    const found = findTaskById(dir, 'child-2');
    assert.equal(found.parentTaskId, 'parent-2');
    assert.equal(found.title, 'Other thing');
  });
});

test('findTaskById returns null when no record matches', () => {
  withTempDir((dir) => {
    assert.equal(findTaskById(dir, 'missing'), null);
  });
});

test('updateTaskById patches the matching record and returns it', () => {
  withTempDir((dir) => {
    upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'BACKLOG' });
    const updated = updateTaskById(dir, 'child-1', { status: 'DONE' });
    assert.equal(updated.status, 'DONE');
    assert.equal(getTasksForParent(dir, 'parent-1')['Do the thing'].status, 'DONE');
  });
});

test('updateTaskById returns null when the id is not tracked', () => {
  withTempDir((dir) => {
    assert.equal(updateTaskById(dir, 'missing', { status: 'DONE' }), null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `mcp/state-store.js` does not exist yet.

- [ ] **Step 3: Implement `mcp/state-store.js`**

```js
// mcp/state-store.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STATE_FILE_NAME = '.pm-sync-state.json';

function filePath(cwd) {
  return join(cwd, STATE_FILE_NAME);
}

export function loadState(cwd = process.cwd()) {
  const path = filePath(cwd);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function saveState(cwd, state) {
  writeFileSync(filePath(cwd), JSON.stringify(state, null, 2), 'utf-8');
}

export function upsertTask(cwd, parentTaskId, title, record) {
  const state = loadState(cwd);
  if (!state[parentTaskId]) state[parentTaskId] = { tasks: {} };
  state[parentTaskId].tasks[title] = { ...state[parentTaskId].tasks[title], ...record };
  saveState(cwd, state);
  return state[parentTaskId].tasks[title];
}

export function getTasksForParent(cwd, parentTaskId) {
  const state = loadState(cwd);
  return state[parentTaskId]?.tasks ?? {};
}

export function findTaskById(cwd, taskId) {
  const state = loadState(cwd);
  for (const [parentTaskId, entry] of Object.entries(state)) {
    for (const [title, record] of Object.entries(entry.tasks ?? {})) {
      if (record.id === taskId) return { parentTaskId, title, record };
    }
  }
  return null;
}

export function updateTaskById(cwd, taskId, patch) {
  const found = findTaskById(cwd, taskId);
  if (!found) return null;
  return upsertTask(cwd, found.parentTaskId, found.title, { ...found.record, ...patch });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/state-store.js tests/state-store.test.js
git commit -m "feat: add local state store for subtask dedup and audit"
```

---

### Task 4: Server bootstrap + `pm_setup` tool

**Files:**
- Create: `mcp/tools/pm-setup.js`
- Create: `mcp/server.js`
- Test: `tests/tools/pm-setup.test.js`

**Interfaces:**
- Consumes: `resolveConfig`/`persistApiKey` (Task 1), `getProjectInfoMini`/`PmApiError` (Task 2), `describePmError` (Task 2).
- Produces: `pmSetupTool` — `{ name: 'pm_setup', description, inputSchema: { api_key: z.string().optional() }, handler(args, ctx) }`. Every later tool module follows this exact shape (`name`/`description`/`inputSchema`/`handler`) so `server.js` can register them uniformly. `handler(args, ctx)` receives `ctx = { cwd }` — tests pass `{ cwd: tempDir }` directly; `server.js` passes `{ cwd: process.cwd() }`.

- [ ] **Step 1: Write the failing tests**

```js
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
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: { name: 'Acme Project', customer_name: 'Acme Corp' } }),
    });
    const result = await pmSetupTool.handler({ api_key: 'new-key' }, { cwd: dir });
    assert.match(result.content[0].text, /Acme Project/);
    assert.match(result.content[0].text, /Acme Corp/);
    assert.equal(existsSync(join(dir, '.pm-sync-config.json')), true);
  }));

test('pm_setup reports an invalid key without persisting it', () =>
  withTempDir(async (dir) => {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ status: 'error', code: 'INVALID_API_KEY', message: 'Key not found' }),
    });
    const result = await pmSetupTool.handler({ api_key: 'bad-key' }, { cwd: dir });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /authentication failed/i);
    assert.equal(existsSync(join(dir, '.pm-sync-config.json')), false);
  }));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `mcp/tools/pm-setup.js` does not exist yet.

- [ ] **Step 3: Implement `mcp/tools/pm-setup.js`**

```js
// mcp/tools/pm-setup.js
import { z } from 'zod';
import { resolveConfig, persistApiKey } from '../config.js';
import { getProjectInfoMini } from '../pm-client.js';
import { describePmError } from '../tool-error.js';

export const pmSetupTool = {
  name: 'pm_setup',
  description:
    'Call once before any other pm_* tool in a project directory. Resolves PM_API_URL/PM_API_KEY and ' +
    'validates the key against the PM system. If no key is available yet, ask the user for one and call ' +
    'this again with api_key set; report the returned project name/customer name back to the user for ' +
    'confirmation before treating the key as valid.',
  inputSchema: { api_key: z.string().optional() },
  handler: async ({ api_key }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    const candidateKey = api_key || config.apiKey;

    if (!candidateKey) {
      return {
        content: [{
          type: 'text',
          text: "No PM_API_KEY found in the environment or local config. Ask the user for the project's API Key, then call pm_setup again with api_key set to it.",
        }],
      };
    }

    try {
      const info = await getProjectInfoMini({ baseUrl: config.baseUrl, apiKey: candidateKey });
      if (api_key) persistApiKey(api_key, cwd);
      return {
        content: [{
          type: 'text',
          text: `PM API key is valid. Project: "${info.data?.name}" (customer: "${info.data?.customer_name}"). Confirm with the user this is the correct project before creating any subtasks.`,
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: describePmError(err) }], isError: true };
    }
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Implement `mcp/server.js`**

```js
// mcp/server.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pmSetupTool } from './tools/pm-setup.js';

const TOOLS = [pmSetupTool];

const server = new McpServer({ name: 'pm-gensubtask', version: '0.1.0' });

for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    { title: tool.name, description: tool.description, inputSchema: tool.inputSchema },
    (args) => tool.handler(args, { cwd: process.cwd() })
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('pm-gensubtask MCP server running via stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});

export { TOOLS };
```

- [ ] **Step 6: Write and run a smoke test for the tool registry**

```js
// tests/server.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../mcp/server.js';

test('server exposes pm_setup in its tool registry', () => {
  assert.ok(TOOLS.some((t) => t.name === 'pm_setup'));
});
```

Run: `npm test`
Expected: PASS. Note: importing `mcp/server.js` runs `main()`, which calls `server.connect(transport)` on a `StdioServerTransport` — this does not block or error under `node --test` since stdio is available; it will print a stderr line, which is expected and harmless.

- [ ] **Step 7: Commit**

```bash
git add mcp/tools/pm-setup.js mcp/server.js tests/tools/pm-setup.test.js tests/server.test.js
git commit -m "feat: add MCP server bootstrap and pm_setup tool"
```

---

### Task 5: `pm_create_subtasks` tool

**Files:**
- Create: `mcp/tools/pm-create-subtasks.js`
- Modify: `mcp/server.js` (add import + entry in `TOOLS`)
- Test: `tests/tools/pm-create-subtasks.test.js`

**Interfaces:**
- Consumes: `createTask`, `getTasks` (Task 2), `getTasksForParent`, `upsertTask` (Task 3), `resolveConfig` (Task 1), `describePmError` (Task 2).
- Produces: `pmCreateSubtasksTool` following the Task 4 tool shape, `inputSchema: { parent_task_id: z.string(), tasks: z.array(z.object({ title: z.string(), description: z.string().optional(), workstream: z.string().optional(), layer: z.string().optional(), assignee_id: z.string().optional() })) }`.

- [ ] **Step 1: Write the failing tests**

```js
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
      { parent_task_id: 'parent-1', tasks: [{ title: 'Do the thing' }] },
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
    await pmCreateSubtasksTool.handler({ parent_task_id: 'parent-1', tasks: [{ title: 'Do the thing' }] }, { cwd: dir });

    let createCalls = 0;
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) return { ok: true, status: 200, json: async () => ({ status: 'success', data: [] }) };
      createCalls++;
      throw new Error('should not be called');
    };
    const result = await pmCreateSubtasksTool.handler({ parent_task_id: 'parent-1', tasks: [{ title: 'Do the thing' }] }, { cwd: dir });
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
    const result = await pmCreateSubtasksTool.handler({ parent_task_id: 'parent-1', tasks: [{ title: 'Do the thing' }] }, { cwd: dir });
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
    const result = await pmCreateSubtasksTool.handler({ parent_task_id: 'parent-1', tasks: [{ title: 'Do the thing' }] }, { cwd: dir });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /title is required/);
  }));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement `mcp/tools/pm-create-subtasks.js`**

```js
// mcp/tools/pm-create-subtasks.js
import { z } from 'zod';
import { createTask, getTasks } from '../pm-client.js';
import { getTasksForParent, upsertTask } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

const taskInputSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  workstream: z.string().optional(),
  layer: z.string().optional(),
  assignee_id: z.string().optional(),
});

export const pmCreateSubtasksTool = {
  name: 'pm_create_subtasks',
  description:
    'Call once you have a fixed list of tasks to track in the PM system, before starting work on any of ' +
    'them. Creates one real PM task per item under parent_task_id, skipping any that already exist ' +
    '(checked locally and against the live PM system).',
  inputSchema: { parent_task_id: z.string(), tasks: z.array(taskInputSchema) },
  handler: async ({ parent_task_id, tasks }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    const localTasks = getTasksForParent(cwd, parent_task_id);
    let liveTasks = null;
    const created = [];
    const skipped = [];

    try {
      for (const task of tasks) {
        if (localTasks[task.title]) {
          skipped.push({ title: task.title, reason: 'already in local state', ...localTasks[task.title] });
          continue;
        }

        if (liveTasks === null) {
          const response = await getTasks(config);
          liveTasks = response.data ?? [];
        }
        const parentEntry = liveTasks.find((t) => t.id === parent_task_id);
        const existingChild = parentEntry?.subtasks?.find((s) => s.title === task.title);
        if (existingChild) {
          const record = { id: existingChild.id, code: null, status: null };
          upsertTask(cwd, parent_task_id, task.title, record);
          skipped.push({ title: task.title, reason: 'already exists in PM system', ...record });
          continue;
        }

        const response = await createTask(config, { ...task, parent_task_id });
        const record = { id: response.data.id, code: response.data.code, status: response.data.status_code };
        upsertTask(cwd, parent_task_id, task.title, record);
        created.push({ title: task.title, ...record });
      }
    } catch (err) {
      return { content: [{ type: 'text', text: describePmError(err) }], isError: true };
    }

    const lines = [];
    if (created.length) {
      lines.push(`Created ${created.length} subtask(s):`);
      for (const c of created) lines.push(`- ${c.code} (${c.id}): ${c.title}`);
    }
    if (skipped.length) {
      lines.push(`Skipped ${skipped.length} already-existing subtask(s):`);
      for (const s of skipped) lines.push(`- ${s.title} (${s.reason})`);
    }
    lines.push(
      'IMPORTANT: call pm_start_subtask(task_id) right before starting work on each of these, and pm_complete_subtask(task_id) right after it is verified done.'
    );
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Wire into `mcp/server.js`**

```js
// mcp/server.js — add near the top with the other tool import
import { pmCreateSubtasksTool } from './tools/pm-create-subtasks.js';

// mcp/server.js — update the TOOLS array
const TOOLS = [pmSetupTool, pmCreateSubtasksTool];
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS — all prior tests plus new ones green.

- [ ] **Step 7: Commit**

```bash
git add mcp/tools/pm-create-subtasks.js mcp/server.js tests/tools/pm-create-subtasks.test.js
git commit -m "feat: add pm_create_subtasks tool with three-way dedup"
```

---

### Task 6: `pm_start_subtask` + `pm_complete_subtask` tools

**Files:**
- Create: `mcp/tools/pm-start-subtask.js`
- Create: `mcp/tools/pm-complete-subtask.js`
- Modify: `mcp/server.js` (add imports + entries in `TOOLS`)
- Test: `tests/tools/pm-start-complete-subtask.test.js`

**Interfaces:**
- Consumes: `patchTask`, `createChecklistItems` (Task 2), `updateTaskById` (Task 3), `resolveConfig` (Task 1), `describePmError` (Task 2).
- Produces: `pmStartSubtaskTool` (`inputSchema: { task_id: z.string() }`), `pmCompleteSubtaskTool` (`inputSchema: { task_id: z.string(), actual_hours: z.number().optional() }`) — both follow the Task 4 tool shape.

- [ ] **Step 1: Write the failing tests**

```js
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

test('pm_complete_subtask PATCHes DONE/100 with actual_hours and posts a Completed-at checklist item', () =>
  withTempDir(async (dir) => {
    upsertTask(dir, 'parent-1', 'Do the thing', { id: 'child-1', code: 'TASK-0001', status: 'DOING' });
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
      if (url.endsWith('/tasks/child-1')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: { id: 'child-1', status_code: 'DONE' } }) };
      }
      return { ok: true, status: 201, json: async () => ({ status: 'success', data: [] }) };
    };
    await pmCompleteSubtaskTool.handler({ task_id: 'child-1', actual_hours: 3.5 }, { cwd: dir });

    assert.deepEqual(calls[0].body, { status_code: 'DONE', progress_percent: 100, actual_hours: 3.5 });
    assert.equal(calls[1].body.items[0].title, 'Completed at');
    assert.equal(getTasksForParent(dir, 'parent-1')['Do the thing'].status, 'DONE');
  }));

test('pm_start_subtask surfaces a NOT_FOUND error without throwing', () =>
  withTempDir(async (dir) => {
    global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ status: 'error', message: 'task not found' }) });
    const result = await pmStartSubtaskTool.handler({ task_id: 'missing' }, { cwd: dir });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /task not found/);
  }));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — modules do not exist yet.

- [ ] **Step 3: Implement `mcp/tools/pm-start-subtask.js`**

```js
// mcp/tools/pm-start-subtask.js
import { z } from 'zod';
import { patchTask, createChecklistItems } from '../pm-client.js';
import { updateTaskById } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmStartSubtaskTool = {
  name: 'pm_start_subtask',
  description:
    'Call right before starting real work on a task that has a matching PM subtask — not before. ' +
    'Marks it DOING in the PM system and records a Started-at checklist entry.',
  inputSchema: { task_id: z.string() },
  handler: async ({ task_id }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    try {
      await patchTask(config, task_id, { status_code: 'DOING' });
      const startedAt = new Date().toISOString();
      await createChecklistItems(config, task_id, [{ title: 'Started at', input_type: 'TEXT', value: startedAt }]);
      updateTaskById(cwd, task_id, { status: 'DOING' });
      return { content: [{ type: 'text', text: `Marked ${task_id} as DOING (started ${startedAt}).` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: describePmError(err) }], isError: true };
    }
  },
};
```

- [ ] **Step 4: Implement `mcp/tools/pm-complete-subtask.js`**

```js
// mcp/tools/pm-complete-subtask.js
import { z } from 'zod';
import { patchTask, createChecklistItems } from '../pm-client.js';
import { updateTaskById } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmCompleteSubtaskTool = {
  name: 'pm_complete_subtask',
  description:
    'Call when a task is fully done and verified (tests pass, review approved) — not merely when code is ' +
    'written. Marks it DONE at 100% progress and records a Completed-at checklist entry.',
  inputSchema: { task_id: z.string(), actual_hours: z.number().optional() },
  handler: async ({ task_id, actual_hours }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    try {
      const patchPayload = { status_code: 'DONE', progress_percent: 100 };
      if (actual_hours !== undefined) patchPayload.actual_hours = actual_hours;
      await patchTask(config, task_id, patchPayload);
      const completedAt = new Date().toISOString();
      await createChecklistItems(config, task_id, [{ title: 'Completed at', input_type: 'TEXT', value: completedAt }]);
      updateTaskById(cwd, task_id, { status: 'DONE' });
      return { content: [{ type: 'text', text: `Marked ${task_id} as DONE (completed ${completedAt}).` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: describePmError(err) }], isError: true };
    }
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Wire into `mcp/server.js`**

```js
// mcp/server.js — add near the top with the other tool imports
import { pmStartSubtaskTool } from './tools/pm-start-subtask.js';
import { pmCompleteSubtaskTool } from './tools/pm-complete-subtask.js';

// mcp/server.js — update the TOOLS array
const TOOLS = [pmSetupTool, pmCreateSubtasksTool, pmStartSubtaskTool, pmCompleteSubtaskTool];
```

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add mcp/tools/pm-start-subtask.js mcp/tools/pm-complete-subtask.js mcp/server.js tests/tools/pm-start-complete-subtask.test.js
git commit -m "feat: add pm_start_subtask and pm_complete_subtask tools"
```

---

### Task 7: `pm_update_progress` tool

**Files:**
- Create: `mcp/tools/pm-update-progress.js`
- Modify: `mcp/server.js` (add import + entry in `TOOLS`)
- Test: `tests/tools/pm-update-progress.test.js`

**Interfaces:**
- Consumes: `patchTask` (Task 2), `updateTaskById` (Task 3), `resolveConfig` (Task 1), `describePmError` (Task 2).
- Produces: `pmUpdateProgressTool`, `inputSchema: { task_id: z.string(), progress_percent: z.number().min(0).max(100).optional(), status_code: z.string().optional(), actual_hours: z.number().optional() }`.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement `mcp/tools/pm-update-progress.js`**

```js
// mcp/tools/pm-update-progress.js
import { z } from 'zod';
import { patchTask } from '../pm-client.js';
import { updateTaskById } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmUpdateProgressTool = {
  name: 'pm_update_progress',
  description:
    'Call mid-task when progress_percent, actual_hours, or status_code needs updating but the task is ' +
    'not yet fully done (use pm_complete_subtask for that). At least one field must be provided.',
  inputSchema: {
    task_id: z.string(),
    progress_percent: z.number().min(0).max(100).optional(),
    status_code: z.string().optional(),
    actual_hours: z.number().optional(),
  },
  handler: async ({ task_id, progress_percent, status_code, actual_hours }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    const payload = {};
    if (progress_percent !== undefined) payload.progress_percent = progress_percent;
    if (status_code !== undefined) payload.status_code = status_code;
    if (actual_hours !== undefined) payload.actual_hours = actual_hours;

    if (Object.keys(payload).length === 0) {
      return {
        content: [{ type: 'text', text: 'No fields provided — pass at least one of progress_percent, status_code, actual_hours.' }],
        isError: true,
      };
    }

    try {
      await patchTask(config, task_id, payload);
      if (status_code !== undefined) updateTaskById(cwd, task_id, { status: status_code });
      return { content: [{ type: 'text', text: `Updated ${task_id}: ${JSON.stringify(payload)}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: describePmError(err) }], isError: true };
    }
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Wire into `mcp/server.js`**

```js
// mcp/server.js — add near the top with the other tool imports
import { pmUpdateProgressTool } from './tools/pm-update-progress.js';

// mcp/server.js — update the TOOLS array
const TOOLS = [pmSetupTool, pmCreateSubtasksTool, pmStartSubtaskTool, pmCompleteSubtaskTool, pmUpdateProgressTool];
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mcp/tools/pm-update-progress.js mcp/server.js tests/tools/pm-update-progress.test.js
git commit -m "feat: add pm_update_progress tool"
```

---

### Task 8: `pm_audit_status` tool

**Files:**
- Create: `mcp/tools/pm-audit-status.js`
- Modify: `mcp/server.js` (add import + entry in `TOOLS`)
- Test: `tests/tools/pm-audit-status.test.js`

**Interfaces:**
- Consumes: `getTasks` (Task 2), `getTasksForParent` (Task 3), `resolveConfig` (Task 1), `describePmError` (Task 2).
- Produces: `pmAuditStatusTool`, `inputSchema: { parent_task_id: z.string() }`. Read-only — makes no PM API writes.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement `mcp/tools/pm-audit-status.js`**

```js
// mcp/tools/pm-audit-status.js
import { z } from 'zod';
import { getTasks } from '../pm-client.js';
import { getTasksForParent } from '../state-store.js';
import { resolveConfig } from '../config.js';
import { describePmError } from '../tool-error.js';

export const pmAuditStatusTool = {
  name: 'pm_audit_status',
  description:
    'Read-only. Cross-checks the local sync record for parent_task_id against the live PM system and ' +
    'reports any subtask whose local status looks stuck — never started, or started but never completed.',
  inputSchema: { parent_task_id: z.string() },
  handler: async ({ parent_task_id }, ctx = {}) => {
    const cwd = ctx.cwd || process.cwd();
    const config = resolveConfig(cwd);
    const localTasks = getTasksForParent(cwd, parent_task_id);

    let liveTasks;
    try {
      const response = await getTasks(config);
      liveTasks = response.data ?? [];
    } catch (err) {
      return { content: [{ type: 'text', text: describePmError(err) }], isError: true };
    }

    const parentEntry = liveTasks.find((t) => t.id === parent_task_id);
    const liveChildIds = new Set((parentEntry?.subtasks ?? []).map((s) => s.id));

    const missingLive = [];
    const neverStarted = [];
    const notCompleted = [];

    for (const [title, record] of Object.entries(localTasks)) {
      if (!liveChildIds.has(record.id)) {
        missingLive.push({ title, record });
        continue;
      }
      if (['BACKLOG', 'PICK', 'TODO'].includes(record.status)) {
        neverStarted.push({ title, record });
      } else if (['DOING', 'TESTING'].includes(record.status)) {
        notCompleted.push({ title, record });
      }
    }

    const lines = [];
    if (missingLive.length) {
      lines.push(`${missingLive.length} subtask(s) tracked locally but not found under the parent in the PM system:`);
      for (const { title, record } of missingLive) lines.push(`- ${title} (${record.id})`);
    }
    if (neverStarted.length) {
      lines.push(`${neverStarted.length} subtask(s) never started (pm_start_subtask not called):`);
      for (const { title, record } of neverStarted) lines.push(`- ${title} (${record.id}): still ${record.status}`);
    }
    if (notCompleted.length) {
      lines.push(`${notCompleted.length} subtask(s) started but not completed:`);
      for (const { title, record } of notCompleted) lines.push(`- ${title} (${record.id}): still ${record.status}`);
    }
    if (!lines.length) lines.push('All tracked subtasks are consistent between local state and the PM system.');

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Wire into `mcp/server.js`**

```js
// mcp/server.js — add near the top with the other tool imports
import { pmAuditStatusTool } from './tools/pm-audit-status.js';

// mcp/server.js — update the TOOLS array
const TOOLS = [pmSetupTool, pmCreateSubtasksTool, pmStartSubtaskTool, pmCompleteSubtaskTool, pmUpdateProgressTool, pmAuditStatusTool];
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS — all 6 tools registered, all tests green.

- [ ] **Step 7: Commit**

```bash
git add mcp/tools/pm-audit-status.js mcp/server.js tests/tools/pm-audit-status.test.js
git commit -m "feat: add pm_audit_status read-only tool"
```

---

### Task 9: Manual e2e script + README

**Files:**
- Create: `scripts/manual-e2e.js`
- Create: `README.md`

**Interfaces:**
- Consumes: `pmSetupTool`, `pmCreateSubtasksTool`, `pmStartSubtaskTool`, `pmCompleteSubtaskTool`, `pmAuditStatusTool` (Tasks 4–8) directly, not through the MCP transport.

No new automated test in this task: `scripts/manual-e2e.js` is explicitly a manual verification aid that requires a real `PM_API_KEY` and live network access to the PM system, neither of which is available in an automated/CI run — this matches spec §6's "one manual/integration script... to verify end-to-end before considering the server done." All logic it exercises is already covered by the mocked unit tests in Tasks 4–8.

- [ ] **Step 1: Write `scripts/manual-e2e.js`**

```js
// scripts/manual-e2e.js
// Manual verification against the real PM API. Requires PM_API_KEY (and optionally PM_API_URL) to be
// set, and a real parent_task_id passed as the first CLI argument. Not run in automated tests.
import { pmSetupTool } from '../mcp/tools/pm-setup.js';
import { pmCreateSubtasksTool } from '../mcp/tools/pm-create-subtasks.js';
import { pmStartSubtaskTool } from '../mcp/tools/pm-start-subtask.js';
import { pmCompleteSubtaskTool } from '../mcp/tools/pm-complete-subtask.js';
import { pmAuditStatusTool } from '../mcp/tools/pm-audit-status.js';

const parentTaskId = process.argv[2];
if (!parentTaskId) {
  console.error('Usage: node scripts/manual-e2e.js <parent_task_id>');
  process.exit(1);
}

function printResult(label, result) {
  console.log(`\n=== ${label} ===`);
  console.log(result.content.map((c) => c.text).join('\n'));
  if (result.isError) throw new Error(`${label} returned an error — stopping.`);
}

const cwd = process.cwd();

printResult('pm_setup', await pmSetupTool.handler({}, { cwd }));

const createResult = await pmCreateSubtasksTool.handler(
  { parent_task_id: parentTaskId, tasks: [{ title: `manual-e2e smoke task ${Date.now()}` }] },
  { cwd }
);
printResult('pm_create_subtasks', createResult);

const { findTaskById } = await import('../mcp/state-store.js');
const created = Object.values((await import('../mcp/state-store.js')).getTasksForParent(cwd, parentTaskId))
  .find((t) => t.status === 'BACKLOG' || t.status === null);
if (!created) throw new Error('Could not find the freshly created task in local state.');

printResult('pm_start_subtask', await pmStartSubtaskTool.handler({ task_id: created.id }, { cwd }));
printResult('pm_complete_subtask', await pmCompleteSubtaskTool.handler({ task_id: created.id, actual_hours: 0.1 }, { cwd }));
printResult('pm_audit_status', await pmAuditStatusTool.handler({ parent_task_id: parentTaskId }, { cwd }));

console.log('\nManual e2e run completed successfully.');
```

- [ ] **Step 2: Write `README.md`**

```markdown
# MCP-GenSubTask

MCP server + Claude Code skill that creates and syncs subtasks with the Alliance ITSC PM system while
implementation work happens locally.

## Setup

1. `npm install`
2. Set `PM_API_KEY` (and optionally `PM_API_URL`, defaults to `https://pm-api.allianceitsc.com`) in your
   environment, or let the `pm_setup` tool ask for it on first use — it is then stored in
   `.pm-sync-config.json` in the calling project's directory (gitignored).
3. Add this plugin's `.mcp.json` entry to your Claude Code MCP configuration (already bundled for
   plugin installs).

## Tools

| Tool | Purpose |
|---|---|
| `pm_setup` | Resolve and validate `PM_API_KEY` against the PM system. |
| `pm_create_subtasks` | Create PM subtasks under a parent task, deduplicated. |
| `pm_start_subtask` | Mark a subtask DOING + log a Started-at checklist entry. |
| `pm_complete_subtask` | Mark a subtask DONE at 100% + log a Completed-at checklist entry. |
| `pm_update_progress` | Patch `progress_percent` / `status_code` / `actual_hours` mid-task. |
| `pm_audit_status` | Read-only cross-check of local sync state vs. the live PM system. |

## Skill

`skills/pm-synced-development/SKILL.md` — use instead of superpowers' `subagent-driven-development` when
you want PM board sync woven into the same per-task loop.

## Testing

- `npm test` — unit tests, HTTP layer mocked, no live calls.
- `node scripts/manual-e2e.js <parent_task_id>` — manual/live verification against the real PM API.
  Requires a real `PM_API_KEY` and a real `parent_task_id`. Not run in CI.

## State

`.pm-sync-state.json` (gitignored) in the calling project's directory tracks the local title → PM task id
mapping used for dedup and audit. Safe to delete — subtasks will simply be re-checked against the live
PM system on next `pm_create_subtasks` call.
```

- [ ] **Step 3: Run full test suite one more time**

Run: `npm test`
Expected: PASS — README/script additions don't affect the test suite.

- [ ] **Step 4: Commit**

```bash
git add scripts/manual-e2e.js README.md
git commit -m "docs: add manual e2e script and README"
```

---

### Task 10: `pm-synced-development` skill

**Files:**
- Create: `skills/pm-synced-development/SKILL.md`

No automated test for this task: it is skill documentation with no executable logic — it directs an LLM's
behavior, not code paths that unit tests can exercise. This mirrors how `subagent-driven-development`
itself (the skill this one mirrors) ships as documentation only.

- [ ] **Step 1: Write `skills/pm-synced-development/SKILL.md`**

```markdown
---
name: pm-synced-development
description: Use when executing implementation plans with independent tasks AND you want each task's progress mirrored into the Alliance ITSC PM system via MCP-GenSubTask's tools
---

# PM-Synced Development

Runs the same per-task loop as superpowers:subagent-driven-development (fresh subagent per task,
two-stage review), with PM system sync calls woven into four specific points. Use this instead of
subagent-driven-development when the user wants task progress visible on the PM board as work happens.

**Requires:** the MCP-GenSubTask server's 6 tools available in this session, and a `parent_task_id` for
the PM task these subtasks nest under (ask the user if not already known — resolve via `pm_setup` then
look it up in the PM system if needed; never guess it).

## The Process

Follow superpowers:subagent-driven-development's process exactly, with these 4 additions:

1. **After** "Read plan, extract all tasks with full text, note context, create TodoWrite" — call
   `pm_create_subtasks(parent_task_id, tasks)` once, using each task's title/description from the plan.
   Keep the returned `{id, code}` per task alongside its TodoWrite entry so later steps know which PM
   `task_id` maps to which plan task.

2. **Before** dispatching each task's implementer subagent — call `pm_start_subtask(task_id)` for that
   task's PM id.

3. **When** the code quality reviewer subagent returns APPROVE for a task — call
   `pm_complete_subtask(task_id)` for that task's PM id, immediately after marking it complete in
   TodoWrite.

4. **After** all tasks are complete, before dispatching the final whole-implementation code reviewer —
   call `pm_audit_status(parent_task_id)` and resolve anything it flags before finishing.

Everything else — implementer prompts, spec review, code quality review, status handling (DONE /
DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED), continuous execution without pausing between tasks — is
identical to superpowers:subagent-driven-development. This skill does not replace or modify that skill's
files; it is a separate process that happens to follow the same shape.

## Red Flags

**Never:**
- Call `pm_start_subtask` for a task before its implementer subagent is actually dispatched (marks the PM
  board as in-progress before work starts).
- Call `pm_complete_subtask` before code quality review has returned APPROVE (marks the PM board as done
  before it's verified).
- Skip `pm_create_subtasks` and call `pm_start_subtask`/`pm_complete_subtask` with a fabricated `task_id`
  — always use the id returned by `pm_create_subtasks` (or found via `pm_setup`/PM lookup for pre-existing
  tasks).
- Skip the final `pm_audit_status` call — it is the only check for sync calls missed mid-loop.
```

- [ ] **Step 2: Commit**

```bash
git add skills/pm-synced-development/SKILL.md
git commit -m "feat: add pm-synced-development skill"
```
