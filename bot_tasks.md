# Skill: Bot Agents Task Management API

This guide provides instructions for AI bot agents to manage tasks in their assigned projects using the project's API Key.

This API belongs to the **Alliance ITSC PM system** — an internal project/task management application used to track work across the company's own projects (not a customer-facing product). Tasks created here show up in the PM app's boards for real project members to see and act on, so treat data (titles, descriptions, assignees) as if a human teammate will read it.

---

## 0. Environment Resolution (do this before any request)

Resolve the base URL and API key from environment variables first — never hardcode either, and never ask the user for the URL.

1. **Base URL:**
   - If env var `PM_API_URL` is set, use it as the base URL (no trailing slash).
   - Otherwise, default to `https://pm-api.allianceitsc.com`.
   - All endpoint paths in this doc (e.g. `/v1/bot-agents/create-task`) are relative to this base URL.

2. **API Key:**
   - If env var `PM_API_KEY` is set, use it as `x-api-key` for every request.
   - If it is **not set**, do not guess, reuse a key seen elsewhere, or proceed unauthenticated. **Ask the user** to provide the project's API Key.

3. **First-time key confirmation (avoid mixing up projects):**
   - Before persisting a newly-provided key, call `GET {base}/v1/bot-agents/project-info-mini` with `x-api-key: <the new key>`.
   - Show the returned `name` (project name) and `customer_name` back to the user and ask them to confirm this is the correct project.
   - Only after explicit confirmation, save the key as `PM_API_KEY` in the environment so future runs don't ask again.
   - If the user says it's the wrong project, discard the key and ask again — do not save an unconfirmed key.
   - If `project-info-mini` itself returns `401 INVALID_API_KEY`, the key is wrong — report this to the user instead of saving it.

4. **Subsequent runs:** once `PM_API_KEY` is set and was confirmed once, reuse it silently without re-confirming on every call — only re-confirm if the key changes or a request unexpectedly returns `401`.

5. **My user ID (`PM_MYID`) — for self-assignment:**
   - If the operator asks to assign a task to themselves ("assign this to me", "gán cho tôi"), you need their `user_id` in this project.
   - If env var `PM_MYID` is set, use it directly as `assignee_id` — do not re-verify it against `get-members` every time.
   - If it is **not set**, call `GET get-members`, show the operator the list of `full_name`/`email` values, and ask them which entry is theirs.
   - Once confirmed, save that `user_id` as `PM_MYID` in the environment so future runs don't ask again.
   - If the operator's identity can't be matched to any member in the list, report this rather than guessing — do not assign to a similarly-named member without confirmation.

---

## Use When
- You are an autonomous bot agent operating on a specific project and have been given that project's API Key (`x-api-key`).
- You need to create a task, read existing tasks (list or single), attach checklist items to a task, or look up project members and their roles.
- You need to find a valid `assignee_id` (and confirm their role) before creating or assigning a task.
- You need to check a task's current status/detail before starting dependent work or adding a checklist to it.
- You need to update a task's `status_code`, `actual_hours`, or `progress_percent` (see "Update Task (partial)", §2.6) — e.g. marking it `DOING`/`DONE` or recording hours spent.

## Do Not Use When
- You do not have a project API Key — do not guess, reuse a key from another project, or fall back to a human user's session credentials.
- The goal is to fully update, rename, reassign, or delete a task, or update/delete a checklist item — **no such endpoint exists**. Only `status_code`/`actual_hours`/`progress_percent` can be updated (see "Update Task (partial)", §2.6). Do not attempt undocumented routes or repurpose `create-task`/checklist-create as a workaround for anything beyond that.
- The goal is bug tracking — use the bug endpoints (`create-bug`, `get-bugs`, `get-bug/:id`) instead of task endpoints.
- The goal is to add/remove a project member or change someone's role — this API has no such capability; it is read-only for members.
- You want to bulk-create many tasks without first checking `get-tasks` for duplicates — check first.

## Decision Workflow
1. **Resolve environment and validate access.** Follow "Environment Resolution" above to get the base URL and `x-api-key` (prompting + confirming via `project-info-mini` if the key is missing). If any call returns `401`, stop immediately (see Error Handling) rather than guessing at a fix.
2. **Check for duplicates before creating.** Call `GET get-tasks` (or `GET get-task/:taskId` if you already hold an id) and compare titles/descriptions to avoid creating a task that already exists.
3. **Resolve the assignee.** If the operator wants the task assigned to themselves, use `PM_MYID` (see "My user ID" in Environment Resolution) instead of guessing from `get-members`. Otherwise, call `GET get-members` to get valid `user_id`s and their `roles`, and pick an assignee whose role matches the task's `workstream`/`layer` (e.g. a `DEV_LEAD` for an architecture task). Never fabricate a UUID.
4. **Create the task.** Call `POST create-task` using only the documented enum values for `workstream`, `layer`, `status_code`, and `priority`. Do **not** send `feature_id` or `requirement_id` — there is currently no reliable way for a bot agent to determine which requirement/feature a task belongs to. Do **not** send `type` (it only drives UI display, not agent logic), `tags`, or `phase` (deprecated fallback for `workstream`) either.
5. **Attach checklist items (optional).** Using the `id` returned from step 4, call `POST tasks/:taskId/checklists` to add sub-steps or verification items. Only use this for lightweight, non-assignable sub-steps — for real sub-tasks that need their own status/assignee, see "Creating Subtasks" below.
6. **Check status before dependent work.** Before starting work that depends on another task, call `GET get-task/:taskId` to confirm its current `status_code`/`assignee_id` rather than assuming.
7. **If a task's status, actual hours, or progress needs correction,** call `PATCH tasks/:taskId` (§2.6) with only the field(s) that changed. For any other correction (title, description, assignee, workstream, etc.) or a delete, there is still no endpoint — escalate via whatever activity/notification channel is available, or inform the human operator.

---

## Creating Subtasks (a list of child tasks under one parent)

"Subtask" in this API means a real Task with `parent_task_id` pointing to the parent — it gets its own `status_code`, `assignee_id`, `workstream`/`layer`, and shows up on the board as a normal task, just nested under its parent. It is **not** the same as a checklist item (see step 5 above) — do not confuse the two when the operator says "subtask"/"sub-task"/"task con".

1. **Resolve the parent.** Get the parent task's `id` from `get-tasks`/`get-task/:taskId` first — never fabricate or guess a `parent_task_id`. Read its `workstream` and `layer` so child tasks can inherit sensible defaults.
2. **Check for existing children before creating.** `GET get-tasks` includes a `subtasks: [{id, title}]` array on each task — find the parent's entry in that list and compare its `subtasks` titles against the ones you're about to create, skipping any that already exist. Only fall back to `GET get-task/:taskId` on the parent if you need more detail than title (e.g. to confirm status).
3. **Draft the child list.** For each subtask, set `title` (required) and `parent_task_id` (the parent's `id`). Default `workstream`/`layer` to the parent's values unless the operator specifies otherwise per child. Do not send `feature_id`/`requirement_id`/`type`/`tags`/`phase` (see Create Task payload notes above).
4. **Resolve assignees per child (optional).** Follow step 3 of the main Decision Workflow (use `PM_MYID` for self-assignment, or `get-members` otherwise) — each child can have a different assignee.
5. **Create children one at a time.** Call `POST create-task` once per subtask (there is no batch-create endpoint). After each call, log the returned `code`/`id` so you can report the full list back to the operator and reuse the ids for checklists or status checks.
6. **Report the result.** Summarize created subtasks (code, title, assignee) back to the operator. If any single create call fails (400/500), stop and report that item's error — do not silently skip it or keep creating the remaining items without telling the operator which one failed.
7. **Volume check.** For more than ~10 subtasks in one request, confirm the full list with the operator before creating — this endpoint has no bulk/transactional create, so a large batch that partially fails can leave the parent in an inconsistent state.

---

## 1. Authentication

All requests to the bot agents API must be authenticated using the following headers:

| Header Name | Type | Description | Required |
|:---|:---|:---|:---|
| `x-api-key` | String | The project's API Key. The server uses this key to automatically associate the request with the correct project. | **Yes** |
| `x-team-id` | String | Optional identifier for the current agent session, team, or execution context. | No |

All endpoints below are mounted under the base path `/v1/bot-agents`, e.g. `POST /v1/bot-agents/create-task`.

### Authentication Errors
| Status | Code | When |
|:---|:---|:---|
| 401 | `API_KEY_MISSING` | `x-api-key` header not provided |
| 401 | `INVALID_API_KEY` | Key not found, expired, or project soft-deleted |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected error while authenticating |

---

## 2. API Endpoints

### 2.1 Create Task
Create a new task under the project associated with the API key.

- **URL:** `/v1/bot-agents/create-task`
- **Method:** `POST`
- **Headers:** 
  - `x-api-key: <api_key>`
  - `Content-Type: application/json`

#### Request Payload
All standard task fields are supported:

| Field Name | Type | Description | Required |
|:---|:---|:---|:---|
| `title` | String | Task title (max 255 chars). | **Yes** |
| `description` | String | Task description. | No |
| `workstream` | String | Workstream enum, one of: `'BA'`, `'DEV'`, `'DEPLOY'`, `'CROSS'`. | No (defaults to `'DEV'`, or fallback to `phase`) |
| `phase` | String | ~~Backward compatibility fallback mapping to `workstream`.~~ **Do not send from bot agents** — deprecated, use `workstream` instead. | No |
| `feature_id` | String (UUID) | ID of feature to associate with this task. **Do not send from bot agents** — there is currently no reliable way for a bot agent to determine the correct feature. | No |
| `requirement_id` | String (UUID) | ID of requirement to associate with this task. **Do not send from bot agents** — there is currently no reliable way for a bot agent to determine the correct requirement. | No |
| `type` | String | Custom task type identifier, used only to drive UI display. **Do not send from bot agents** — not needed for agent logic. | No |
| `layer` | String | Task layer, one of: `'REQUIREMENT'`, `'FEATURE'`, `'ANALYSIS'`, `'BA'`, `'UI'`, `'API'`, `'DATA'`, `'TEST'`, `'SYS'`, `'SEC'`, `'DEPLOY'`, `'PLAN'`, `'REVIEW'`, `'FIXBUG'`, `'INTERGATE'`, `'DOC'`, `'OTHER'`. | No |
| `status_code` | String | Status code, one of: `'BACKLOG'`, `'PICK'`, `'TODO'`, `'DOING'`, `'TESTING'`, `'DONE'`, `'READY_DEPLOY'`, `'DEPLOYED'`, `'PENDING'`, `'CLOSED'`. | No (defaults to `'BACKLOG'`) |
| `assignee_id` | String (UUID) | Member user ID assigned to the task. Must be a valid project member ID (see `project-info` endpoint). | No |
| `priority` | String | Priority code (e.g. `'P0'`, `'P1'`, `'P2'`, `'P3'`). | No (defaults to `'P2'`) |
| `due_date` | String | ISO Date string format (`YYYY-MM-DD`). | No |
| `estimate_hours` | Number | Hours estimated to complete. | No |
| `tags` | Array of Strings | Task tags. **Do not send from bot agents** — not needed for agent logic. | No (defaults to `[]`) |
| `size` | Number | Estimation size from 1 to 10. | No (defaults to `5`) |
| `difficulty` | Number | Task difficulty from 1 to 5. | No (defaults to `3`) |
| `impact` | Number | Task impact level from 1 to 5. | No (defaults to `3`) |
| `parent_task_id` | String (UUID) | Parent task ID to create as a subtask (see "Creating Subtasks" below). | No |
| `progress_percent`| Number | Task progress from 0 to 100. | No (defaults to `0`) |
| `is_notify_task` | Boolean | Whether to trigger instant chat alerts for creation. | No |
| `link_slide` | String | URL to link Google Slides (`https://docs.google.com/presentation/d/...`). | No |

#### Request Payload JSON Example
```json
{
  "title": "Build Product API Endpoints",
  "description": "Create REST controllers for listing and updating products.",
  "workstream": "DEV",
  "layer": "API",
  "priority": "P1",
  "estimate_hours": 8,
  "size": 6,
  "difficulty": 4
}
```

#### Response (201 Created)
```json
{
  "status": "success",
  "data": {
    "id": "1b304c71-7f55-48c8-8acd-f522e10077ee",
    "project_id": "f9d20edc-a11b-4ce4-bb9e-75b76fbb8c9c",
    "code": "TASK-0021",
    "title": "Build Product API Endpoints",
    "description": "Create REST controllers for listing and updating products.",
    "status_code": "BACKLOG",
    "workstream": "DEV",
    "priority": "P1",
    "tags": ["backend", "api"],
    "created_by": "00000000-0000-0000-0000-000000000000",
    "updated_by": "00000000-0000-0000-0000-000000000000",
    "created_at": "2026-07-30T09:00:00.000Z",
    "updated_at": "2026-07-30T09:00:00.000Z"
  }
}
```

> `code` (e.g. `TASK-0021`) is auto-generated by the server. `created_by`/`updated_by` are set to the system bot's fixed UUID, not the calling agent's identity.

#### Error Responses
| Status | Cause |
|:---|:---|
| 400 | Zod validation failed (e.g. missing `title`, invalid `workstream`/`layer` enum, malformed `due_date` or `link_slide`) — response body: `{ "status": "error", "message": "<first zod error message>" }` |
| 401 | Missing/invalid API key (see Authentication) |

---

### 2.2 Get Tasks
Retrieve a list of all active tasks belonging to the project associated with the API key.

- **URL:** `/v1/bot-agents/get-tasks`
- **Method:** `GET`
- **Headers:** 
  - `x-api-key: <api_key>`

> Returns the full list of active tasks for the project (up to 1000 tasks) — there is no filtering or pagination on this endpoint. Filter/search client-side, or use Get Task Detail (below) to fetch one task by ID.

#### Response (200 OK)
```json
{
  "status": "success",
  "data": [
    {
      "id": "1b304c71-7f55-48c8-8acd-f522e10077ee",
      "title": "Build Product API Endpoints",
      "description": "Create REST controllers for listing and updating products.",
      "status": "BACKLOG",
      "phase": "DEV",
      "subtasks": [
        { "id": "2c405d82-8f66-49d9-9bde-f633f21188ff", "title": "Implement GET /products endpoint" }
      ]
    }
  ]
}
```

> `subtasks` is a simple `{id, title}` list of this task's direct children (tasks with `parent_task_id` pointing to it). Use it to check whether a task already has subtasks before creating new ones — see "Creating Subtasks" below. `subtasks` is `[]` when the task has no children.

---

### 2.3 Get Task Detail
Retrieve full detail of a single task by ID, scoped to the project associated with the API key.

- **URL:** `/v1/bot-agents/get-task/:taskId`
- **Method:** `GET`
- **Headers:** 
  - `x-api-key: <api_key>`

#### Response (200 OK)
```json
{
  "status": "success",
  "data": {
    "id": "1b304c71-7f55-48c8-8acd-f522e10077ee",
    "project_id": "f9d20edc-a11b-4ce4-bb9e-75b76fbb8c9c",
    "code": "TASK-0021",
    "title": "Build Product API Endpoints",
    "description": "Create REST controllers for listing and updating products.",
    "status_code": "BACKLOG",
    "status_label": "Backlog",
    "workstream": "DEV",
    "layer": "API",
    "priority": "P1",
    "assignee_id": "a1b2c3d4-0000-0000-0000-000000000001",
    "assignee_name": "John Doe",
    "assignee_avatar": "https://...",
    "feature_id": null,
    "feature_code": null,
    "feature_title": null,
    "requirement_id": null,
    "requirement_title": null,
    "parent_task_id": null,
    "parent_task_title": null,
    "parent_task_code": null,
    "tags": ["backend", "api"],
    "estimate_hours": 8,
    "actual_hours": 0,
    "progress_percent": 0,
    "created_by": "00000000-0000-0000-0000-000000000000",
    "created_by_name": "System Bot",
    "created_at": "2026-07-30T09:00:00.000Z",
    "updated_at": "2026-07-30T09:00:00.000Z",
    "can_edit": false,
    "can_delete": false,
    "canShowAskDone": false,
    "users_pick": [],
    "my_roles_in_project": [],
    "assignee_roles_in_project": ["DEV"]
  }
}
```

> `can_edit`/`can_delete`/`canShowAskDone`/`my_roles_in_project` are computed for an anonymous caller (the bot agent has no user identity), so they will always be `false`/`[]`. Use `assignee_roles_in_project` to see the assignee's roles in the project.

#### Error Responses
| Status | Cause |
|:---|:---|
| 404 | `taskId` does not exist or is soft-deleted (`Task not found`) |
| 403 | Task exists but belongs to a different project than the API key (`Task does not belong to this project`) |
| 401 | Missing/invalid API key (see Authentication) |

---

### 2.4 Get Project Members
Retrieve all members of the project associated with the API key, along with each member's role(s).

- **URL:** `/v1/bot-agents/get-members`
- **Method:** `GET`
- **Headers:** 
  - `x-api-key: <api_key>`

> Use this to look up a valid `assignee_id` (and its role) before calling Create Task.

#### Response (200 OK)
```json
{
  "status": "success",
  "data": [
    {
      "user_id": "a1b2c3d4-0000-0000-0000-000000000001",
      "full_name": "John Doe",
      "email": "john.doe@example.com",
      "avatar_url": "https://...",
      "roles": ["DEV", "DEV_LEAD"]
    }
  ]
}
```

> `roles` is an array of `RoleProjectCode` values, one of: `'PM'`, `'PRJ_LEAD'`, `'BA_LEAD'`, `'FE_LEAD'`, `'BE_LEAD'`, `'DEV_LEAD'`, `'QC_LEAD'`, `'BA'`, `'DEV'`, `'QA'`, `'STAKEHOLDER'`, `'QC'`, `'DevOps'`, `'CS'`, `'DBA'`. A member can have zero or multiple roles.

#### Error Responses
| Status | Cause |
|:---|:---|
| 401 | Missing/invalid API key (see Authentication) |

---

### 2.5 Create Task Checklist
Create one or more checklist items for a specific task.

- **URL:** `/v1/bot-agents/tasks/:taskId/checklists`
- **Method:** `POST`
- **Headers:** 
  - `x-api-key: <api_key>`
  - `Content-Type: application/json`

> There is no separate "get checklist" endpoint, and no update/delete endpoint for checklist items — this creation endpoint is the only one exposed to bot agents.

#### Request Payload
| Field Name | Type | Description | Required |
|:---|:---|:---|:---|
| `items[].title` | String | Checklist item title (max 255 chars). | **Yes** |
| `items[].description` | String | Checklist item description. | No |
| `items[].input_type` | String | One of `'CHECKBOX'`, `'TEXT'`, `'LINK'`. | No (defaults to `'CHECKBOX'`) |
| `items[].target_entity_type` | String | Entity type this item targets (max 50 chars). | No |
| `items[].value` | String | Value captured for `TEXT`/`LINK` input types. | No |
| `items[].is_done` | Boolean | Whether the item is already completed. | No (defaults to `false`) |
| `items[].linked_entity_id` | String (UUID) | ID of an entity linked to this item. | No |
| `items[].linked_entity_type` | String | Type of the linked entity (max 50 chars). | No |
| `items[].order_no` | Number | Display order. | No (defaults to `0`) |

```json
{
  "items": [
    {
      "title": "Checklist Item Title (Required)",
      "description": "Checklist Item Description (Optional)",
      "input_type": "CHECKBOX / TEXT / LINK (Optional, default is CHECKBOX)",
      "is_done": true / false (Optional, default is false),
      "order_no": 1 (Optional, default is 0)
    }
  ]
}
```

#### Response (201 Created)
```json
{
  "status": "success",
  "data": [
    {
      "id": "2b404c71-7f55-48c8-8acd-f522e10077ef",
      "task_id": "1b304c71-7f55-48c8-8acd-f522e10077ee",
      "title": "Checklist Item Title",
      "description": "Checklist Item Description",
      "input_type": "CHECKBOX",
      "is_done": false,
      "order_no": 1,
      "created_at": "2026-07-30T09:00:00.000Z",
      "updated_at": "2026-07-30T09:00:00.000Z"
    }
  ]
}
```

#### Error Responses
| Status | Cause |
|:---|:---|
| 400 | Zod validation failed (e.g. missing `title`, invalid `input_type` enum) |
| 403 | `taskId` refers to a task that does not belong to the project owning the API key (`Task does not belong to this project`) |
| 401 | Missing/invalid API key (see Authentication) |

---

### 2.6 Update Task (partial)
Update a subset of fields on an existing task — `status_code`, `actual_hours`, and/or `progress_percent` only. This is **not** a full task replace: any other field (`title`, `description`, `assignee_id`, `workstream`, etc.) cannot be changed through this endpoint, and there is still no delete endpoint.

- **URL:** `/v1/bot-agents/tasks/:taskId`
- **Method:** `PATCH`
- **Headers:** 
  - `x-api-key: <api_key>`
  - `Content-Type: application/json`

#### Request Payload
| Field Name | Type | Description | Required |
|:---|:---|:---|:---|
| `status_code` | String | One of: `'BACKLOG'`, `'PICK'`, `'TODO'`, `'DOING'`, `'TESTING'`, `'DONE'`, `'READY_DEPLOY'`, `'DEPLOYED'`, `'PENDING'`, `'CLOSED'`, `'NEED_FIX'`, `'NEED_TEST'`, `'WAITING_FIX'`, `'WAITING_TEST'`. | No |
| `actual_hours` | Number | Actual hours spent, >= 0. **Overwrites** the existing value — it does not add to it. | No |
| `progress_percent` | Number | Progress from 0 to 100. | No |

At least one of the three fields must be provided; sending none returns a 400.

```json
{
  "status_code": "DOING",
  "progress_percent": 40
}
```

#### Response (200 OK)
Returns the full updated task record (raw DB fields — the same core fields as Get Task Detail, without the computed `can_edit`/`can_delete`/roles additions).

#### Error Responses
| Status | Cause |
|:---|:---|
| 400 | Zod validation failed — no fields provided, invalid `status_code` enum, or negative/out-of-range `actual_hours`/`progress_percent`. Response body: `{ "status": "error", "message": "<first zod error message>" }` |
| 403 | `taskId` refers to a task that does not belong to the project owning the API key (`Task does not belong to this project`) |
| 404 | `taskId` does not exist or is soft-deleted (`Task not found`) |
| 401 | Missing/invalid API key (see Authentication) |

> Only send the exact `status_code` enum values listed above. This endpoint runs no role/workflow gating (unlike the human-facing status-transition UI) — it's meant for straightforward progress/status/hours updates, not for enforcing approval flows or transition rules.

---

## 3. Current API Limitations

The bot agents API intentionally exposes a minimal task surface. The following operations are **not available** and must not be attempted:
- Full update (e.g. `title`, `description`, `assignee_id`, `workstream`) or delete of an existing task. Only `status_code`/`actual_hours`/`progress_percent` can be updated, via "Update Task (partial)" (§2.6).
- Get, update, or delete existing checklist items (creation only).
- Filtering, sorting, or pagination on `get-tasks` or `get-members`.
- Add/remove project members or change member roles.

---

## 4. Error Handling Behavior

Every response uses the shape `{ "status": "success", "data": ... }` on success, or `{ "status": "error", "code": "...", "message": "...", "details": [...] }` on failure. Handle each status deterministically:

| Status | Meaning | Agent behavior |
|:---|:---|:---|
| `401 API_KEY_MISSING` / `INVALID_API_KEY` | Auth failed | **Stop immediately.** Do not retry with the same key. Do not attempt other endpoints. Report the failure — this is a configuration problem, not a transient error. |
| `400` (Zod validation) | Payload invalid | Read `message`/`details` for the exact field that failed. Fix only that field against the documented enums/types in this doc and retry once. Do not silently drop the field or invent a value to force success. |
| `403` (task/checklist not in project) | Cross-project reference | The `taskId` belongs to a different project than your API key. Do not retry — re-verify the `taskId` came from your own `get-tasks`/`get-members` results, not from another agent or hardcoded value. |
| `404` (task not found) | Task missing or deleted | Do not retry blindly. Re-fetch `get-tasks` to confirm the id is still valid before trying again. |
| `409` (conflict, if returned by underlying services) | Resource already exists | Treat as non-fatal; look up the existing resource instead of retrying the create. |
| `500 INTERNAL_SERVER_ERROR` | Unexpected server error | Retry at most once after a short backoff. If it fails again, stop and report — do not loop indefinitely. |

General rules:
- Never retry a failed call more than once without changing the input.
- Never mask an error by proceeding as if the call succeeded (e.g. assuming a task was created when the response was 400).
- Always surface the `message` field back to whatever is consuming the agent's output (log, chat notification, etc.) so a human can diagnose it.

---

## 5. Safety Rules

- **Scope discipline:** Only operate on the project tied to your `x-api-key`. Never attempt to pass another project's id, or reuse a `taskId`/`user_id` you observed from a different project/session.
- **No destructive actions:** This API has no delete endpoint for tasks or checklists, and update (§2.6) is limited to `status_code`/`actual_hours`/`progress_percent` by design — do not try to simulate deletion (e.g. by setting `status_code: 'CLOSED'` en masse) unless that is the explicit, single task requested by the operator.
- **No enum guessing:** Only use the exact enum values documented in this file for `workstream`, `layer`, `status_code`, `priority`, and `input_type`. Sending an undocumented value will fail validation — do not "guess and check" against production.
- **Update is not idempotent-safe against concurrent human edits:** `PATCH tasks/:taskId` overwrites whatever value a human may have set in the meantime (e.g. `actual_hours` is a set, not an add). Prefer reading `get-task/:taskId` immediately before an update if the value might have changed since you last saw it.
- **No secrets in payloads:** Never include the API key, other credentials, or another project's data inside `title`/`description`/`tags` fields.
- **Idempotency awareness:** `create-task` and the checklist endpoint are not idempotent — calling them twice creates duplicate records. Always check `get-tasks` first (see Decision Workflow) before creating.
- **Respect `assignee_id` validity:** Only assign tasks to `user_id`s returned by `get-members` for the same project. Do not assign to an id you have not verified belongs to this project.
- **Rate/volume awareness:** Avoid bulk-creating large numbers of tasks or checklist items in a tight loop without an explicit instruction to do so; prefer batching and confirming with the operator for large volumes.
- **Escalate, don't improvise:** If a requested action has no corresponding endpoint (update, delete, role change, etc.), report the limitation rather than attempting an undocumented workaround.

---

## 6. Quick Examples

### First-time key confirmation
```bash
# ${PM_API_URL:-https://pm-api.allianceitsc.com} resolves the base URL per Environment Resolution
curl -X GET "${PM_API_URL:-https://pm-api.allianceitsc.com}/v1/bot-agents/project-info-mini" \
  -H "x-api-key: THE_NEW_KEY_FROM_USER"
# -> confirm returned name/customer_name with the user before saving as PM_API_KEY
```

### curl Example
```bash
# Create Task Checklist
curl -X POST "${PM_API_URL:-https://pm-api.allianceitsc.com}/v1/bot-agents/tasks/1b304c71-7f55-48c8-8acd-f522e10077ee/checklists" \
  -H "x-api-key: ${PM_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "title": "Verify response headers",
        "order_no": 1
      },
      {
        "title": "Write unit tests for controller",
        "order_no": 2
      }
    ]
  }'
```

### Update Task (partial)
```bash
curl -X PATCH "${PM_API_URL:-https://pm-api.allianceitsc.com}/v1/bot-agents/tasks/1b304c71-7f55-48c8-8acd-f522e10077ee" \
  -H "x-api-key: ${PM_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "status_code": "DOING",
    "progress_percent": 40
  }'
```
