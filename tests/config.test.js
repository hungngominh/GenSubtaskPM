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
