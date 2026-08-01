// tests/server.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../mcp/server.js';

test('server exposes pm_setup in its tool registry', () => {
  assert.ok(TOOLS.some((t) => t.name === 'pm_setup'));
});
