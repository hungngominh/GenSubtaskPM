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

// --- .gitignore: append any PM-sync entries not already present ---
// .mcp.json is included because it embeds this machine's absolute path to server.js —
// not portable to other developers/machines, so it must stay local and untracked.
const gitignorePath = join(resolvedTarget, '.gitignore');
const pmSyncEntries = ['.pm-sync-config.json', '.pm-sync-state.json', '.mcp.json'];
const existingGitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
const missingEntries = pmSyncEntries.filter((entry) => !existingGitignore.includes(entry));
if (missingEntries.length > 0) {
  const needsLeadingNewline = existingGitignore.length > 0 && !existingGitignore.endsWith('\n');
  const needsHeader = !existingGitignore.includes('## PM sync');
  const block = `${needsHeader ? '## PM sync (contains API key / local state — never commit)\n' : ''}${missingEntries.join('\n')}\n`;
  appendFileSync(gitignorePath, `${needsLeadingNewline ? '\n' : ''}${existingGitignore ? '\n' : ''}${block}`);
  console.log(`Updated ${gitignorePath} (added: ${missingEntries.join(', ')})`);
} else {
  console.log(`${gitignorePath} already ignores PM sync files — skipped.`);
}

console.log(
  '\nDone. Next step: open a Claude Code session in that project and run pm_setup to enter and validate the PM_API_KEY.'
);
