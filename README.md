# HSE Platform — Elsewedy Polymers

Web platform for the factory's Health, Safety & Environment team. It replaces paper
forms and Excel sheets with one system used by workers on their phones and by
department heads, HSE staff and management on desktop.

**Main modules**

| Module | What it does |
| --- | --- |
| Work permits | Workers request permits (hot work, height, confined space, lifting, LOTO…); department head → HSE approval workflow; closure; printable permit with a QR verification code. |
| Hazard reports | Anyone reports a hazard with a photo; HSE routes it to maintenance; repair with an "after" photo; e-mail alert for high-risk reports and escalation when they stay open. |
| Training | Lecture sessions with PIN-based attendance, quizzes, recordings, worker requests and hour targets. |
| Emergency drills | Drill sessions, attendance and the official drill report (print / Word). |
| Monthly inspections | Inspection programmes, items and monthly records with Excel import/export. |
| Penalties | Penalty register with repeat-offence alerts. |
| Dashboards & reports | KPI dashboards, executive view, scheduled monthly/quarterly reports by e-mail, Excel / Power BI exports. |
| Safety assistant | Arabic chatbot over the factory's safety instructions and SDS data, optionally backed by an LLM. |
| Administration | Users and roles, backups (download, e-mail, daily snapshots), SMTP settings, audit log. |

## Tech stack

- **Backend:** Node.js 20+, Express 4
- **Database:** PostgreSQL (Supabase). Tests and local development can run on PGlite (Postgres compiled to WebAssembly, in-process).
- **Frontend:** vanilla JavaScript + CSS, bundled and minified at build time (terser, clean-css); installable PWA with web push.
- **Documents:** HTML print templates, ExcelJS, docx, QR codes.

## Project structure

```
server.js                 entry point: connect to the database, run startup tasks, start HTTP(S)
src/
  app.js                  Express app: middleware order and route registration
  config.js, constants.js environment-derived settings, roles and shared constants
  db/                     database layer (see "Data layer" below)
  data/                   collection accessors used by the app, write queue
  middleware/             auth (JWT, roles), security headers, rate limits, caching, body limits, errors
  routes/                 one router per feature (permits, hazards, trainings, auth, admin, …)
  services/               notifications & push, e-mail, WhatsApp, backups, alerts, reminders,
                          scheduled reports, startup tasks (background jobs start from server.js)
  documents/              print templates, permit/hazard/drill documents, safety reports
  importers/              Excel importers for legacy permit, hazard and penalty registers
  chatbot/                safety assistant and its knowledge base
client/
  js/, css/               frontend sources (feature folders, order in manifest.json)
public/                   static files served as-is, including the built app.min.js / style.min.css
db/migrations/            SQL migrations (schema, indexes, access control)
scripts/                  build, migrate, restore-backup
tests/                    integration test runner, synthetic fixture and test suites
```

## Getting started

```bash
npm install
cp .env.example .env        # then set JWT_SECRET and DATABASE_URL
npm run db:migrate          # creates the schema (uses DATABASE_ADMIN_URL if set)
npm run build               # bundles client/ into public/
npm start                   # http://localhost:3000
```

For a local database without Postgres, point `DATABASE_URL` at a folder:
`DATABASE_URL=pglite:///C:/dev/hse-db` (or any absolute path), then run `npm run db:migrate`.

To load existing data, restore a backup file produced by the platform (admin → backup, or a daily snapshot):

```bash
npm run db:restore -- path/to/hse-backup.json.gz
```

Emergency team members (names and phone numbers) are personal data and are not stored in the
repository; load them once with `npm run db:import-teams -- path/to/emergency-team-members.json`.

On the very first start with an empty database a `superadmin` account is created and its
temporary password is printed once in the server log.

## Data layer

All business data lives in the `hse` schema. Each entity has its own table
(`permits`, `hazards`, `trainings`, `employees`, `users`, `inspection_records`, …) with:

- `data jsonb` — the complete record, so nothing the application stores is ever lost or reshaped;
- typed, indexed **generated columns** for the fields used in queries and reporting
  (dates, status, department, employee code, …);
- a `position` column that keeps the application's ordering.

At start-up the server loads every table into memory, so reads never wait on the network.
Each write updates memory synchronously and is persisted by a write-behind queue
(`src/db/persistence.js`): only changed rows are sent, in one transaction, coalesced and
retried with backoff if the database is unreachable. On shutdown (SIGTERM) the queue is
drained before the process exits. This design assumes **a single server instance**.

Security on the database side: the app connects as `hse_app`, which can only read/write the
`hse` tables (no DDL, no other schemas); RLS is enabled on every table with a policy for that
role only; the schema is not exposed through the Supabase Data API.

## Security model

- **Admin accounts** (`super_admin`, `hse_admin`, `dept_admin`, `maint_admin`) log in with
  username + employee code + password. Department accounts are shared, but every person sets
  a personal password tied to their employee code on first login; until then the session can
  only set that password. A shared password issued by an admin works for one person only: it
  stops working once that person has a personal password, and the next member gets a new one.
- **Read-only accounts** (`ceo`, `hse_director`) can view everything except backups,
  SMTP settings and user management, and can't change anything (enforced server-side).
- **Workers** log in with employee code + password; their identity always comes from the token.
- Department heads only see and act on their own department's permits, hazards, employees and penalties.
- Sessions: short-lived JWTs (HS256) renewed by the client, ending after 12 hours; revoked
  immediately when an account changes. Download/print links use 2-minute tokens bound to one path.
- Brute force: per-person and per-account lockouts plus per-IP limits; identical responses for
  unknown users and wrong passwords.
- Uploads: images validated by magic bytes, random server-generated names, size limits; stored in the database.
- HTTP: strict security headers and CSP, no stack traces in responses, request size limits
  (large bodies only for authenticated upload endpoints).
- Secrets: the SMTP password is stored AES-256-GCM encrypted; `.env` is never committed.

## Testing

```bash
npm test                    # all suites
npm test -- security        # suites whose name matches
npm run lint
```

`tests/run.js` creates a temporary PGlite database, loads a synthetic dataset
(`tests/fixtures/seed-data.js` — no real employee data) plus test accounts, starts a fresh
server per suite and routes e-mail to a local SMTP sink. CI runs lint, a build check and the
tests on every push (`.github/workflows/tests.yml`).

## Deployment

Railway (or any Node host) + Supabase:

1. Create the schema once with `npm run db:migrate` using an admin connection string
   (`DATABASE_ADMIN_URL`), and set a password for the `hse_app` role.
2. Set the environment variables from `.env.example` — at least `JWT_SECRET`,
   `DATABASE_URL` (Supabase session pooler, user `hse_app.<project-ref>`) and `PUBLIC_BASE_URL`.
3. Start command: `npm start`. Built assets are committed, so no build step is needed at deploy time.
4. Keep a single instance (see "Data layer").

Health checks: `GET /healthz` (public, minimal) and `GET /api/admin/health` (admins).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Start with auto-restart on file changes |
| `npm run build` / `build:check` | Bundle the frontend / verify the committed bundle is current |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:restore -- <file>` | Restore a platform backup into `DATABASE_URL` |
| `npm run db:import-teams -- <file>` | Load emergency team members (names, phones) into `DATABASE_URL` |
| `npm test` | Integration tests |
| `npm run lint` | ESLint |
