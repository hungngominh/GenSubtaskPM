// tests/tools/pm-create-parent-task.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pmCreateParentTaskTool } from '../../mcp/tools/pm-create-parent-task.js';

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-create-parent-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('creates a new parent task via POST create-task when no title match exists', () =>
  withTempDir(async (dir) => {
    let createCalls = 0;
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: [{ id: 'other-1', title: 'Other task' }] }) };
      }
      createCalls++;
      return {
        ok: true,
        status: 201,
        json: async () => ({ status: 'success', data: { id: 'parent-1', code: 'TASK-0001', title: 'New Epic', status_code: 'BACKLOG' } }),
      };
    };
    const result = await pmCreateParentTaskTool.handler({ title: 'New Epic', assignee_id: 'user-1' }, { cwd: dir });
    assert.equal(createCalls, 1);
    assert.match(result.content[0].text, /Created parent task TASK-0001 \(parent-1\)/);
    assert.match(result.content[0].text, /parent_task_id="parent-1"/);
  }));

test('skips creating when a top-level task with the same title already exists', () =>
  withTempDir(async (dir) => {
    let createCalls = 0;
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) {
        return { ok: true, status: 200, json: async () => ({ status: 'success', data: [{ id: 'parent-1', title: 'New Epic' }] }) };
      }
      createCalls++;
      throw new Error('should not be called');
    };
    const result = await pmCreateParentTaskTool.handler({ title: 'New Epic', assignee_id: 'user-1' }, { cwd: dir });
    assert.equal(createCalls, 0);
    assert.match(result.content[0].text, /already exists — parent_task_id=parent-1/);
  }));

test('creates a parent task with no assignee_id when the operator explicitly opts out', () =>
  withTempDir(async (dir) => {
    let createCalls = 0;
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) return { ok: true, status: 200, json: async () => ({ status: 'success', data: [] }) };
      createCalls++;
      return {
        ok: true,
        status: 201,
        json: async () => ({ status: 'success', data: { id: 'parent-1', code: 'TASK-0001', title: 'New Epic', status_code: 'BACKLOG' } }),
      };
    };
    const result = await pmCreateParentTaskTool.handler({ title: 'New Epic' }, { cwd: dir });
    assert.equal(createCalls, 1);
    assert.match(result.content[0].text, /Created parent task TASK-0001 \(parent-1\)/);
  }));

test('passes priority/size/difficulty/impact/is_notify_task/link_slide/status_code through to create-task', () =>
  withTempDir(async (dir) => {
    let sentPayload = null;
    global.fetch = async (url, opts) => {
      if (url.endsWith('/get-tasks')) return { ok: true, status: 200, json: async () => ({ status: 'success', data: [] }) };
      sentPayload = JSON.parse(opts.body);
      return {
        ok: true,
        status: 201,
        json: async () => ({ status: 'success', data: { id: 'parent-1', code: 'TASK-0001', title: 'New Epic', status_code: 'TODO' } }),
      };
    };
    await pmCreateParentTaskTool.handler(
      {
        title: 'New Epic', priority: 'P1', status_code: 'TODO', size: 8, difficulty: 4, impact: 5,
        is_notify_task: true, link_slide: 'https://docs.google.com/presentation/d/abc',
      },
      { cwd: dir }
    );
    assert.equal(sentPayload.priority, 'P1');
    assert.equal(sentPayload.status_code, 'TODO');
    assert.equal(sentPayload.size, 8);
    assert.equal(sentPayload.difficulty, 4);
    assert.equal(sentPayload.impact, 5);
    assert.equal(sentPayload.is_notify_task, true);
    assert.equal(sentPayload.link_slide, 'https://docs.google.com/presentation/d/abc');
  }));

test('passes due_date and estimate_hours through to create-task when the operator asks for them', () =>
  withTempDir(async (dir) => {
    let sentPayload = null;
    global.fetch = async (url, opts) => {
      if (url.endsWith('/get-tasks')) return { ok: true, status: 200, json: async () => ({ status: 'success', data: [] }) };
      sentPayload = JSON.parse(opts.body);
      return {
        ok: true,
        status: 201,
        json: async () => ({ status: 'success', data: { id: 'parent-1', code: 'TASK-0001', title: 'New Epic', status_code: 'BACKLOG' } }),
      };
    };
    await pmCreateParentTaskTool.handler(
      { title: 'New Epic', due_date: '2026-08-15', estimate_hours: 6 },
      { cwd: dir }
    );
    assert.equal(sentPayload.due_date, '2026-08-15');
    assert.equal(sentPayload.estimate_hours, 6);
  }));

test('surfaces a VALIDATION error from create-task without throwing', () =>
  withTempDir(async (dir) => {
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) return { ok: true, status: 200, json: async () => ({ status: 'success', data: [] }) };
      return { ok: false, status: 400, json: async () => ({ status: 'error', message: 'title is required' }) };
    };
    const result = await pmCreateParentTaskTool.handler({ title: '', assignee_id: 'user-1' }, { cwd: dir });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /title is required/);
  }));

test('resolves with isError instead of throwing on a non-PmApiError failure', () =>
  withTempDir(async (dir) => {
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      if (url.endsWith('/get-tasks')) return { ok: true, status: 200, json: async () => ({ status: 'success', data: [] }) };
      throw new TypeError('fetch failed');
    };
    try {
      const result = await pmCreateParentTaskTool.handler({ title: 'New Epic', assignee_id: 'user-1' }, { cwd: dir });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Unexpected error during pm_create_parent_task/);
    } finally {
      global.fetch = originalFetch;
    }
  }));
