// mcp/tools/pm-setup.js
import { z } from 'zod';
import { resolveConfig, persistApiKey } from '../config.js';
import { getProjectInfoMini, PmApiError } from '../pm-client.js';
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
      const message = err instanceof PmApiError
        ? describePmError(err)
        : `Unexpected error during pm_setup: ${err.message}`;
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  },
};
