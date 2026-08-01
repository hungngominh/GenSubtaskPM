// mcp/server.js
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pmSetupTool } from './tools/pm-setup.js';
import { pmCreateSubtasksTool } from './tools/pm-create-subtasks.js';
import { pmStartSubtaskTool } from './tools/pm-start-subtask.js';
import { pmCompleteSubtaskTool } from './tools/pm-complete-subtask.js';
import { pmUpdateProgressTool } from './tools/pm-update-progress.js';
import { pmAuditStatusTool } from './tools/pm-audit-status.js';
import { pmListMembersTool } from './tools/pm-list-members.js';

const TOOLS = [pmSetupTool, pmCreateSubtasksTool, pmStartSubtaskTool, pmCompleteSubtaskTool, pmUpdateProgressTool, pmAuditStatusTool, pmListMembersTool];

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

// Only auto-start the stdio transport when this file is run directly (e.g. `node mcp/server.js`
// or `npm start`), not when it's imported — importing it for tests must not open stdin and hang
// the test runner's process-exit detection.
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}

export { TOOLS };
