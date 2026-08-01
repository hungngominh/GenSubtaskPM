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
