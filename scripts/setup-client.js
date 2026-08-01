// scripts/setup-client.js
// Quick client-project setup: wires a target project's .mcp.json to this repo's MCP
// server (absolute path, no code duplication) and gitignores the local PM-sync files.
// Does NOT touch the API key — run pm_setup inside a Claude Code session in the target
// project afterward to enter/validate it (keeps the key out of shell history and logs).
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const targetDir = process.argv[2];
if (!targetDir) {
  console.error('Usage: node scripts/setup-client.js <path-to-target-project>');
  process.exit(1);
}

const resolvedTarget = resolve(targetDir);
if (!existsSync(resolvedTarget)) {
  console.error(`Target project directory does not exist: ${resolvedTarget}`);
  process.exit(1);
}

const serverPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.js').replace(/\\/g, '/');

// --- .mcp.json: create or merge in the pm-gensubtask entry, preserving other servers ---
const mcpJsonPath = join(resolvedTarget, '.mcp.json');
let mcpConfig = { mcpServers: {} };
if (existsSync(mcpJsonPath)) {
  try {
    mcpConfig = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
  } catch {
    console.error(`${mcpJsonPath} exists but is not valid JSON — fix or remove it, then re-run.`);
    process.exit(1);
  }
  if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
}
mcpConfig.mcpServers['pm-gensubtask'] = {
  type: 'stdio',
  command: 'node',
  args: [serverPath],
};
writeFileSync(mcpJsonPath, `${JSON.stringify(mcpConfig, null, 2)}\n`);
console.log(`Wrote ${mcpJsonPath}`);

// --- .gitignore: append PM-sync entries if not already present ---
const gitignorePath = join(resolvedTarget, '.gitignore');
const pmSyncBlock = '## PM sync (contains API key / local state — never commit)\n.pm-sync-config.json\n.pm-sync-state.json\n';
const existingGitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
if (!existingGitignore.includes('.pm-sync-config.json')) {
  const needsLeadingNewline = existingGitignore.length > 0 && !existingGitignore.endsWith('\n');
  appendFileSync(gitignorePath, `${needsLeadingNewline ? '\n' : ''}${existingGitignore ? '\n' : ''}${pmSyncBlock}`);
  console.log(`Updated ${gitignorePath}`);
} else {
  console.log(`${gitignorePath} already ignores PM sync files — skipped.`);
}

console.log(
  '\nDone. Next step: open a Claude Code session in that project and run pm_setup to enter and validate the PM_API_KEY.'
);
