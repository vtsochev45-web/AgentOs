# Workspace

## Overview

pnpm workspace monorepo using TypeScript. This is the **Openclaw Agent OS** — a mobile-first web dashboard for managing AI agents and a remote Hostinger VPS from a phone. It replaces Telegram commands with a full computer-like experience.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle for API, Vite for frontend)
- **AI**: Replit AI Integrations (OpenAI proxy, no user API key needed), uses `gpt-5.2`

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server (port 8080)
│   ├── mockup-sandbox/     # Design mockup sandbox (port 8081)
│   └── openclaw/           # React+Vite frontend (previewPath: /)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   ├── integrations/
│   │   ├── integrations-openai-ai-server/   # OpenAI server-side client
│   │   └── integrations-openai-ai-react/    # OpenAI React hooks
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml     # pnpm workspace config (with allowed build scripts)
├── tsconfig.base.json      # Shared TS options
├── tsconfig.json           # Root TS project references
└── package.json            # Root package
```

## Applications

### Frontend: `artifacts/openclaw` (`@workspace/openclaw`)

React + Vite single-page app at path `/`. Mobile-first with bottom navigation.

**6 main sections:**
1. **Home** (`/`) — Command Center with active agent roster + live telemetry feed
2. **Agents** (`/agents`) — Create/manage agents; each agent card links to AgentWorkspace
3. **Agent Workspace** (`/agents/:id`) — Perplexity-style streaming chat with reasoning steps, source citations, follow-up chips
4. **VPS** (`/vps`) — Web terminal (xterm.js+SSH2), system stats, process manager, services manager
5. **Network** (`/network`) — D3 force graph showing agents as nodes
6. **Activity** (`/activity`) — Real-time log of all agent/VPS actions
7. **Settings** (`/settings`) — VPS SSH config, AI model, SMTP, search provider

**Key files:**
- `src/App.tsx` — Wouter router with Shell layout
- `src/components/layout/Shell.tsx` — Desktop sidebar + mobile bottom nav
- `src/hooks/use-sse.ts` — SSE chat streaming + activity stream hooks
- `src/hooks/use-websocket.ts` — WebSocket terminal hook
- `vite.config.ts` — Proxies `/api` to `localhost:8080`

### API Server: `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server on port 8080. Routes at `/api/*`.

**Route files:**
- `src/routes/agents.ts` — Agents CRUD + SSE chat + conversation management + agent-to-agent messages
- `src/routes/vps.ts` — VPS config, stats, processes, services, files (SFTP), exec, log tail (SSE)
- `src/routes/activity.ts` — Activity log + SSE stream
- `src/routes/settings.ts` — App settings (AI model, SMTP, search provider)

**Library files:**
- `src/lib/agentRunner.ts` — OpenAI tool-calling loop with SSE streaming response
- `src/lib/agentTools.ts` — Tool implementations: web_search, vps_shell, file_read/write/list, code_exec, send_email
- `src/lib/sshManager.ts` — SSH2 client for exec, SFTP read/write/list
- `src/lib/wsTerminal.ts` — WebSocket terminal server (SSH2 shell)
- `src/lib/activityEmitter.ts` — EventEmitter for real-time activity + agent status broadcasts
- `src/lib/encryption.ts` — AES-256-GCM encryption for VPS credentials at rest

**WebSocket:** Terminal at `/api/vps/terminal` (upgraded via `http.createServer`)

## Database Schema

Tables (all in PostgreSQL):
- `agents` — AI agent definitions (name, persona, tools_enabled, status, last_active_at)
- `agent_conversations` — Conversation threads per agent
- `agent_conversation_messages` — Messages with sources_json for web citations
- `agent_messages` — Agent-to-agent delegation messages
- `activity_log` — Global timestamped activity feed
- `vps_config` — VPS SSH config with `encrypted_credential` (AES-256-GCM)
- `app_settings` — AI model, SMTP, search provider, Brave API key

Run migrations: `pnpm --filter @workspace/db run push`

## AI Agent System

- Uses Replit AI Integrations OpenAI proxy (no API key needed)
- Model: `gpt-5.2` for general tasks (use `max_completion_tokens`, not `max_tokens`)
- Tool calling loop: up to 5 iterations with parallel tool execution
- SSE event types: `step` (reasoning), `source` (web citation), `content` (answer chunks), `followups` (3 chips), `conversationId`, `done`
- Tools: `web_search`, `vps_shell`, `file_read`, `file_write`, `file_list`, `code_exec`, `send_email`

## VPS Integration

- SSH2 library for all VPS operations
- Native crypto build failed (uses pure-JS fallback which works fine)
- Credentials encrypted with AES-256-GCM using `ENCRYPTION_SECRET` env var
- WebSocket terminal uses SSH2 shell stream proxied over WebSocket
- SFTP for file browsing and editing

## Development

- Frontend: `pnpm --filter @workspace/openclaw run dev`
- API server: `pnpm --filter @workspace/api-server run dev`  
- Codegen: `pnpm --filter @workspace/api-spec run codegen`
- DB push: `pnpm --filter @workspace/db run push`

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. Always typecheck from the root: `pnpm run typecheck`.
