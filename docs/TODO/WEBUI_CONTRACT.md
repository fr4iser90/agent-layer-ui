# WebUI integration contract (Agent Layer)

This document is the **stable integration surface** for front ends (e.g. Open WebUI fork) that talk to Agent Layer over HTTP. Copy it into the UI repo or link to this path in git; implementation details belong here, UI wiring belongs there.

**UI/product layout** (workspaces, badges, image page, system-prompt rules): see [WEBUI_DESIGNS.md](WEBUI_DESIGNS.md).

**Service identity:** FastAPI app title `agent-layer` (version aligned with `src/api/main.py`).  
**Canonical spec changes:** bump version in code when you change response shapes or auth rules, and add a short note under [Changelog](#changelog) below.

---

## 1. Base URL and transport

- **Base:** operator-defined, e.g. `https://agent.example.com` or `http://agent:8088` in Docker.
- **JSON** for request/response bodies unless noted (SSE for streaming chat).
- **TLS:** recommended on any non-loopback deployment.

---

## 2. Authentication

### 2.1 Login (browser or server-side token exchange)

`POST /auth/login`  
**Auth:** none  
**Body:** `{ "email": string, "password": string }`  
**200:** `{ "access_token", "refresh_token", "token_type": "bearer", "expires_in": 900, "user": { "id", "email", "role" } }`  
**401:** invalid credentials

### 2.2 Refresh

`POST /auth/refresh`  
**Auth:** none  
**Body:** `{ "refresh_token": string }`  
**200:** `{ "access_token", "token_type": "bearer", "expires_in": 900 }`  
**401:** invalid or expired refresh token

### 2.3 Protected routes

Almost all routes require **`Authorization: Bearer <token>`** where `<token>` is either:

- a **JWT access token** from `/auth/login` or `/auth/refresh`, or  
- a **per-user API key** (stored hashed server-side; same header format).

If the header is missing or invalid, the API returns **401** with body `{"error":"unauthorized"}`.

### 2.4 Public routes (no `Authorization`)

Exact paths (see `auth_middleware` in `src/api/main.py`):

- `GET /health`
- `GET /v1/models` (Ollama passthrough for model lists)
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/claim` (if implemented / reserved)
- `GET /` (redirect or JSON hint)
- Paths under `/control/` (static control panel when shipped)

**Exception:** `POST /v1/user/secrets/register-with-otp` is allowed without Bearer (OTP-bound registration from chat).

---

## 3. User and tenant identity (multi-user)

Chat, tools, RAG ingest, and user secrets resolve **user id** and **tenant id** from headers so the WebUI can map its own user to Agent Layer’s DB user.

**Headers** (defaults in `src/core/config.py`):

| Purpose | Header | Notes |
|--------|--------|--------|
| External user id | First non-empty of `AGENT_USER_SUB_HEADER` list, else `X-OpenWebUI-User-Id`, `X-Agent-User-Sub` | Comma-separated env `AGENT_USER_SUB_HEADER` overrides the default list. |
| Tenant | `X-Agent-Tenant-Id` (or `AGENT_TENANT_ID_HEADER`) | Integer ≥ 1; invalid/missing → `1`. |

**Open WebUI:** enable forwarding of user info headers so `X-OpenWebUI-User-Id` (or your chosen header) is set on every request to Agent Layer.

**Behavior:** `resolve_user_tenant` ensures a stable internal user row for that external sub + tenant (`src/domain/http_identity.py`).

---

## 4. OpenAI-compatible chat (primary UI integration)

### 4.1 Chat completions

`POST /v1/chat/completions`  
**Auth:** required  
**Body:** OpenAI-style `chat.completions` request (model, messages, optional `tools`, `tool_choice`, `stream`, etc.).  
**Response:** OpenAI-style `chat.completions` JSON; if `stream: true`, **SSE** (`text/event-stream`) with chunked completion (compatible with clients that expect a single completion converted to stream — see `_completion_to_sse_lines` in `main.py`).

### 4.2 Optional routing headers (agent behavior)

| Header | Meaning |
|--------|--------|
| `X-Agent-Router-Categories` | Comma-separated router category ids (tool domains) to bias routing. |
| `X-Agent-Tool-Domain` | Single domain hint for tool filtering. |

These are **optional**; omit for default router behavior.

### 4.3 WebSocket chat (duplex, per-round events)

`WebSocket /ws/v1/chat`  
**Auth:** `?token=<JWT_or_API_key>` on the handshake URL **or** header `Authorization: Bearer <same>`. Same optional-connection-key rules as `POST /v1/chat/completions` when `optional_connection_key` is set in operator settings. If that key is **not** configured, the same routes (including this WebSocket) allow the handshake **without** a token, matching HTTP optional-route behavior.

**User/tenant:** Same headers as §3 on the WebSocket handshake (`AGENT_USER_SUB_HEADER` list, `AGENT_TENANT_ID_HEADER`). Browsers often cannot set arbitrary handshake headers; use a same-origin reverse proxy that injects them, or backend support for query parameters if you must run cross-origin from a pure SPA.

#### Recommended WebUI rendering (`/agent/*`)

Treat the server frame stream as a **timeline** (sidebar, collapsible strip, or step list), not only the final assistant bubble:

1. **`agent.session`** — routed category, router categories, `forwarded_tools`.
2. **`agent.llm_round_start`** / **`agent.llm_round`** — round index, model `tool_calls`, short `content_excerpt`.
3. **`agent.tool_start`** / **`agent.tool_done`** — tool name; `tool_done` may include `result_chars`.
4. **`agent.step_wait`** — optional human-in-the-loop pause; show **Continue** sending `continue_step`.
5. **`agent.done`** — round finished (final text or `max_tool_rounds` / other end states).
6. **`chat.completion`** — final OpenAI-shaped completion for the transcript (same as HTTP).

**Cancel** maps to a control that sends `cancel` (honoured before the next internal LLM round; does not abort a request already in flight at Ollama).

#### Step-by-round mode (WebSocket-only)

In the **`chat`** frame, inside `body`:

- **`agent_pause_between_rounds`:** `true` (or `"true"` / `1`) — after the model returns **tool calls** and the server has **finished running those tools**, the server emits **`agent.step_wait`** and **blocks** until the client sends **`{"type":"continue_step"}`**. No pause after a round that ends with plain text or on the last possible round.

While waiting, the client may send **`add_tools`** and **`cancel`**.

**HTTP `POST /v1/chat/completions`** ignores `agent_pause_between_rounds` (no control queue); step mode is **WebSocket-only**.

**Client → server** (JSON text frames):

| `type` | Purpose |
|--------|---------|
| `ping` | Server replies `{"type":"pong"}`. |
| `cancel` | Abort before the **next** internal LLM round (does not interrupt Ollama in flight). Also aborts while blocked on **`agent.step_wait`**. |
| `add_tools` | `names: string[]` — extra tool function names for **subsequent** rounds (registry + denylist apply). |
| `continue_step` | After **`agent.step_wait`**, resume when **`agent_pause_between_rounds`** was set on this turn’s `chat.body`. |
| `chat` | Start a turn: `body` = same object as `POST /v1/chat/completions` (minus `stream`); optional `router_categories_header`, `tool_domain_header`. |

**Server → client** (JSON): `agent.session`, `agent.llm_round_start`, `agent.llm_round`, `agent.tool_start`, `agent.tool_done`, optional **`agent.step_wait`**, `agent.done`, `agent.cancelled` / `agent.aborted`, then `{"type":"chat.completion","data":{...}}` (or `error`). Multiple `chat` turns may be sent on one connection.

---

## 5. Models

`GET /v1/models`  
**Auth:** public  
**Response:** JSON from Ollama’s `/v1/models` (passthrough).

---

## 6. Tools (discovery and execution)

### 6.1 List tools (OpenAI `tools[]` shape + metadata)

`GET /v1/tools`  
**Auth:** required  
**Response:**

```json
{
  "tools": [ /* OpenAI tool specs */ ],
  "tools_meta": [ /* per-module metadata */ ]
}
```

### 6.2 Generic runner (Open WebUI “tool server” style)

`POST /tools/run`  
**Auth:** required  
**Body:** `{ "name": "<tool_function_name>", "arguments": { ... } }`  
**200:** `{ "result": <JSON-serializable> }`  
**400:** missing name or bad input  
**500:** execution error

### 6.3 Per-tool POST (direct path)

`POST /{tool_name}`  
**Auth:** required  
**Body:** JSON object = tool arguments (same as `arguments` above).  
**200:** `{ "result": ... }`

Tool names must not collide with reserved top-level paths (e.g. `v1`, `auth`, `health`, `openapi`, `tools`).

### 6.4 Router categories (for UI presets)

`GET /v1/router/categories`  
**Auth:** required  
**Response:** `{ "categories": [ ... ] }` — catalog for operator/WebUI labels.

### 6.5 OpenAPI specs for tools (codegen / docs)

| Method | Path | Auth | Purpose |
|--------|------|------|--------|
| GET | `/openapi.json` | required | All registered tools as synthetic paths `/{toolName}` POST. |
| GET | `/openapi/domains` | required | List domains + `openapi_url` per domain. |
| GET | `/openapi/{domain}.json` | required | Tools filtered by domain. |
| GET | `/openapi/tool/{tool_name}/openapi.json` | required | Single tool. |

---

## 7. Admin (operator)

**Auth:** required; some routes use `@require_permission("write", "tool")` (admin role passes).

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/v1/admin/tools` | Tool metadata only. |
| POST | `/v1/admin/reload-tools` | Rescan tool directories. Query: `scope=all|extra` (both full rescan). |
| POST | `/v1/admin/create-tool` | Create/replace tool module (same contract as chat `create_tool`). |
| POST | `/v1/admin/rag/ingest` | RAG text ingest (requires `AGENT_RAG_ENABLED=true`). Body: `text` (required), optional `domain`, `title`, `source_uri`. |

---

## 8. User secrets API

Prefix: `/v1/user/secrets`  
**Auth:** required for all except OTP registration.

| Method | Path | Purpose |
|--------|------|--------|
| POST | `/v1/user/secrets/register-with-otp` | **Public:** body `otp`, `service_key`, `secret` (string or JSON object). |
| GET | `/v1/user/secrets` | List service keys (no values). |
| POST | `/v1/user/secrets` | Upsert secret: `service_key`, `secret`. |
| DELETE | `/v1/user/secrets/{service_key}` | Delete secret. |

Requires `AGENT_SECRETS_MASTER_KEY` on the server for encrypt-at-rest.

---

## 9. Health

`GET /health`  
**Auth:** public  
**200:** `{ "status": "ok", "database": "ok" }`  
**503:** database unavailable

---

## 10. CORS

Controlled by **`AGENT_CORS_ORIGINS`** (comma-separated). If the list does not contain `*`, credentials may be enabled in middleware. Align the WebUI origin with this env in deployment.

---

## 11. Planned / out of scope (coordinate before implementing in UI)

The following are **not** part of this contract until explicitly added to Agent Layer and documented here:

- **ComfyUI / image pipeline:** dedicated upload + job status + workflow schema endpoints (your fork can add UI routes that call a future `GET/POST /v1/...` once defined).
- **Capabilities flags** in WebUI (e.g. `image_pipeline`, `agent_routing`) are **UI/workspace concerns**; Agent Layer only needs the correct headers + endpoints above.

When you add backend endpoints, extend this file and optionally publish **OpenAPI** for those routes.

---

## 12. How the WebUI repo should use this

1. **Point** the OpenAI API base URL (or custom connection) at Agent Layer’s origin.  
2. **Send** `Authorization: Bearer …` on every protected call (login or API key).  
3. **Forward** user id (and tenant if you use it) via the headers in §3.  
4. **Tools:** either configure Open WebUI’s tool server to `POST /tools/run` or register tools whose server URL maps to `POST /{tool_name}`.  
5. **Regressions:** if Agent Layer changes status codes or JSON keys, update this document and the UI in the same release train.

---

## Changelog

| Date | Note |
|------|------|
| 2026-04-07 | Initial contract document; `/auth/refresh` documented as public for refresh-token flow. |
| 2026-04-08 | §4.3 WebSocket: timeline guidance, `agent_pause_between_rounds`, `continue_step`, `agent.step_wait`; optional auth without connection key. |
