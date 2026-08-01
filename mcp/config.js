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
