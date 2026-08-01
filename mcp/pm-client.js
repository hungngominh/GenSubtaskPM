// mcp/pm-client.js

export class PmApiError extends Error {
  constructor({ status, code, message, type, details }) {
    super(message);
    this.name = 'PmApiError';
    this.status = status;
    this.code = code;
    this.type = type;
    this.details = details;
  }
}

function classify(status, body) {
  const message = body?.message || `Request failed with status ${status}`;
  const code = body?.code;
  const types = { 400: 'VALIDATION', 401: 'AUTH', 403: 'CROSS_PROJECT', 404: 'NOT_FOUND', 409: 'CONFLICT' };
  const type = types[status] || (status >= 500 ? 'SERVER' : 'UNKNOWN');
  return new PmApiError({ status, code, message, type, details: body });
}

async function rawRequest(config, method, path, body) {
  const res = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) throw classify(res.status, parsed);
  return parsed;
}

async function request(config, method, path, body) {
  try {
    return await rawRequest(config, method, path, body);
  } catch (err) {
    if (err instanceof PmApiError && err.type === 'SERVER') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return rawRequest(config, method, path, body);
    }
    throw err;
  }
}

export async function getProjectInfoMini(config) {
  return request(config, 'GET', '/v1/bot-agents/project-info-mini');
}

export async function createTask(config, payload) {
  return request(config, 'POST', '/v1/bot-agents/create-task', payload);
}

export async function getTasks(config) {
  return request(config, 'GET', '/v1/bot-agents/get-tasks');
}

export async function getTaskDetail(config, taskId) {
  return request(config, 'GET', `/v1/bot-agents/get-task/${taskId}`);
}

export async function patchTask(config, taskId, payload) {
  return request(config, 'PATCH', `/v1/bot-agents/tasks/${taskId}`, payload);
}

export async function createChecklistItems(config, taskId, items) {
  return request(config, 'POST', `/v1/bot-agents/tasks/${taskId}/checklists`, { items });
}
