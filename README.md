# IT Helpdesk · AI-assisted ticketing

An internal IT ticketing system: staff report problems in plain Thai or English, and **Claude triages each ticket** — picking the category and priority, writing a one-line summary for the queue, and drafting a first reply that the IT agent edits before sending.

Built from what I saw doing user support: people describe problems vaguely, urgency depends on business impact rather than tone, and agents lose time re-reading tickets and writing the same first replies.

**Stack:** NestJS 12 · Angular 22 · TypeORM · PostgreSQL · Anthropic Claude API · JWT · Vitest · Docker · GitHub Actions

## What it does

| | |
|---|---|
| **AI triage** | Claude (`claude-opus-5-5`, structured output validated with Zod) returns category, priority, summary and a draft reply. If no API key is set, the call fails, or the daily cap is hit, a keyword-rule fallback takes over — filing a ticket never depends on the AI being up. |
| **SLA tracking** | Due time set by priority (4 h urgent → 72 h low), overdue flags, % resolved within SLA, average resolution time. |
| **Status flow** | `open → in_progress ⇄ waiting → resolved → closed`, enforced on the server. A requester can only cancel an open ticket or confirm/reject a fix; a reply from the requester moves a *waiting* ticket back to the queue. |
| **Safe "take ticket"** | Claiming uses one conditional `UPDATE … WHERE assignee IS NULL`, so when two agents click at once exactly one wins and the other gets `409`. |
| **Roles** | Requester, agent, admin. Requesters see only their own tickets (others return `404`, not `403`), never see internal notes or the AI draft. |

## Try it

Demo accounts (password `Demo@2026`): `user@demo.local` (requester), `agent@demo.local` (IT agent), `admin@demo.local`.
The login page has one-click buttons for each. API docs (Swagger) are at `/api/docs`.

### Run locally

```bash
# API on :3000 — uses in-memory SQLite (sql.js) when DATABASE_URL is not set
cd api && npm ci && npm run start:dev
# Angular on :4200, proxying /api to :3000
cd web && npm ci && npx ng serve
```

### Run with Docker + PostgreSQL

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build   # key optional
# open http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Supabase works). Unset = in-memory SQLite. |
| `DATABASE_SCHEMA` | Optional Postgres schema (e.g. `helpdesk`) to share a database with other apps. |
| `JWT_SECRET` | Required in production. |
| `ANTHROPIC_API_KEY` | Enables Claude triage. Unset = keyword rules. |
| `AI_DAILY_LIMIT` | Max Claude calls per day per instance (default 100), so a public demo can't run up a bill. |
| `SEED_DEMO` | `0` to skip demo data. |

## Tests

```bash
cd api
npm test          # unit: status flow, SLA, rule triage
npm run test:e2e  # 18 HTTP tests against a real database: auth, permissions, flow, concurrent claim
```

CI runs type-checking, both suites and the Angular build on every push.

## Design notes

- **Domain rules are plain functions** (`api/src/domain.ts`) with no framework or database, so the status flow and SLA math are unit-tested directly.
- **The AI is advisory.** It never sends anything to the requester; the draft is shown only to staff, and every field it sets can be changed by an agent. Ticket text is passed to Claude inside tags and the response is schema-validated.
- **Cost control:** low effort for a classification task, a cached system prompt, a per-day cap, and the rule fallback.
- `synchronize: true` keeps the demo to one command; a production deployment would use TypeORM migrations.
