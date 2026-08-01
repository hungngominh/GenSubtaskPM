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
