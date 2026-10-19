# Voice Tunes India

CRM, sales, quotations and operations platform for Voice Tunes India — one app, one login, one database.

It covers the sales CRM (leads, calls, follow-ups), projects and tasks, marketing, HR, invoices and the
client portal, together with the quotation generator, pricing rules, artists and payments that previously ran
as the separate VTI ERP (NestJS + MongoDB); its data is imported with `pnpm migrate:vti`.

Everything — website and API — is **one Next.js app** (`apps/web`) that deploys to **Vercel** as it is. The
Android app (`apps/mobile`) dials leads from the CRM and, after every call, opens a form that logs the
outcome and next follow-up straight into the CRM. It can also record calls itself and upload them; the CRM turns
them into text (any language) with a short summary; the super admin can ask the **AI Assistant** anything
about the business, typed or spoken, in any language.

The interface uses the Voice Tunes India logo colours — yellow `#FCCC13` and black — defined once as design
tokens at the top of `apps/web/src/app/globals.css`.

## Tech Stack

- **App:** Next.js 16 (App Router) + Tailwind CSS v4 + Radix UI, deployed on Vercel
- **API:** Express 5 served from one Next.js API route (`src/pages/api/[...path].ts` → `src/server`), a single Vercel function
- **State:** Zustand + TanStack Query v5
- **Database:** PostgreSQL (Neon) + Drizzle ORM; migrations run on every deployment
- **Money:** exact decimal math (`decimal.js` over PostgreSQL `numeric`)
- **Live updates:** the website polls `/api/realtime` (notifications, task boards, CRM lists) — no sockets needed
- **Background jobs:** Google Sheets / Meta lead sync, Exotel call status, reminders — run on site and phone-app traffic, or `/api/cron/tick`
- **Files:** Cloudflare R2, private bucket served through the API (payment screenshots, project files); local disk in development
- **Auth:** JWT (15min access + 7d httpOnly refresh cookie; the phone app gets the refresh token in the body)
- **Phone app:** native Android (Kotlin), no third-party libraries
- **AI:** speech to text through any OpenAI-style transcription API (Whisper / GPT-4o transcribe, or Groq);
  Claude (Anthropic API) for the AI Assistant and call summaries

## Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- A PostgreSQL database (e.g. [Neon](https://neon.tech)) — or run one locally with `pnpm db:local`, no install needed

## Setup (local development)

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Configure environment** — copy `apps/web/.env.example` to `apps/web/.env.local` and set:
   - `DATABASE_URL` (for `pnpm db:local`: `postgresql://postgres:postgres@localhost:5433/voicetunes?sslmode=disable`)
   - `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (`openssl rand -hex 32`)
   - optionally `RESEND_API_KEY` for email (task notifications, password reset, etc.)

3. **Start everything** — the local database, the database setup (migrations, default roles and settings)
   and the app:
   ```bash
   pnpm dev
   ```
   Open http://localhost:3000 — the API is on the same address under `/api`.

4. **Seed demo data (optional)** — demo users, projects and tasks, plus the real quotation catalog:
   ```bash
   pnpm db:seed
   ```

## Deploying to Vercel

1. **Import the repository** in Vercel and set **Root Directory** to `apps/web` (framework: Next.js). The
   `vercel-build` script applies database migrations and then builds.
2. **Database** — create a Neon database (or use the Neon integration) and add its **pooled** connection string
   (host contains `-pooler`) as `DATABASE_URL`. Run the functions close to the database: `vercel.json` uses
   `sin1` (Singapore); change it to match your Neon region.
3. **Environment variables** (Project → Settings → Environment Variables): `DATABASE_URL`,
   `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`, `APP_TIMEZONE`, plus `RESEND_API_KEY` / `EMAIL_FROM`,
   Google / Meta / Exotel keys if you use them, and `WEB_URL` only for a custom domain. See `apps/web/.env.example`.
4. **File storage (Cloudflare R2)** — in Cloudflare create a **private** R2 bucket, then **R2 → Manage API tokens**
   → create a token with *Object Read & Write* on that bucket. Add `R2_ACCOUNT_ID` (R2 overview page),
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` to Vercel. Files are served through the app, so the
   bucket never needs public access. Uploads are limited to 4 MB on Vercel.
5. **Background jobs** run whenever someone has the CRM or the phone app open (phones check in every 25 s).
   For guaranteed 24/7 runs, call `GET https://<your-domain>/api/cron/tick` every minute with
   `Authorization: Bearer <CRON_SECRET>`: Vercel Cron on the Pro plan (set the schedule in `vercel.json` to
   `* * * * *`), or a free scheduler such as cron-job.org. The included daily cron works on every plan.
6. **Call recordings and the AI Assistant (optional)** — add `TRANSCRIBE_API_KEY` (an OpenAI key; or a Groq key
   with `TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1` and `TRANSCRIBE_MODEL=whisper-large-v3`) for
   transcripts and voice questions, and `ANTHROPIC_API_KEY` for the AI Assistant and call summaries. Recordings
   go straight from the phones to R2, so they need the R2 settings above.
7. **Deploy**, then open **CRM Admin → Communication & Calls**: every channel and the background jobs report
   their status there.
8. **Phones** — build the Android app with your address pre-filled
   (`./gradlew assembleRelease -PcrmUrl=https://<your-domain>`, see `apps/mobile/README.md`) and sign in on each
   BDM phone with their CRM login.

Webhook addresses for Meta and Exotel: `https://<your-domain>/api/integrations/meta/webhook` and
`https://<your-domain>/api/integrations/exotel/status?token=<EXOTEL_WEBHOOK_TOKEN>`.

## Moving the VTI ERP data over

The former VTI ERP kept its data in MongoDB. Import it once (safe to re-run — nothing is duplicated):

```bash
cd apps/web
VTI_MONGODB_URI="mongodb+srv://…/vti_erp" VTI_STORAGE_PATH="D:\VTI-ERP\backend\storage" pnpm migrate:vti --dry-run
VTI_MONGODB_URI="mongodb+srv://…/vti_erp" VTI_STORAGE_PATH="D:\VTI-ERP\backend\storage" pnpm migrate:vti
```

It brings over users (their passwords keep working, and they can sign in with email or employee ID),
employees, departments, designations, roles, settings, the catalog and pricing rules, every quotation with
its lines, payments with their screenshots (uploaded to R2 when the `R2_*` settings are present), quotation numbering and the activity log. Records that already
exist are matched (by email, employee ID, slug, code, name or quotation number) instead of duplicated.

**Roles.** By default each VTI role becomes its own role (`VTI_ADMIN`, `VTI_MANAGER`, `VTI_HR`,
`VTI_EMPLOYEE`, …) with exactly the permissions it had, so nobody gains CRM, project or HR access;
VTI Super Admins become `SUPER_ADMIN`. Once you have checked who is who, move people onto the built-in roles in
**User Master**. `--map-roles` does that mapping during the import instead
(admin → Management, manager → Project Manager, hr → HR, employee → Team Member).

## Moving the old PHP CRM data over

The PHP CRM before this one (MySQL, phpMyAdmin dump `tornaawp_vti.sql`) is imported with one command; the dump is
read directly, so no MySQL is needed. Safe to re-run: records are keyed by their old ids, and a re-run rewrites
records imported earlier with the current mapping.

```bash
cd apps/web
pnpm import:legacy-crm --file "/path/to/tornaawp_vti.sql" --dry-run
pnpm import:legacy-crm --file "/path/to/tornaawp_vti.sql" --logins ~/Downloads/legacy-bdm-logins.csv
```

It brings over the BDMs as sales logins (old usernames, new passwords written to the `--logins` file; they start out of
the lead rotation), every lead with its old detailed status, every follow-up call with its call activity, status,
remarks, call time and reason, lead transfers, automatic assignments and the raw Meta lead-form rows (under an
inactive archive source). Old times are India time. A number that is already a lead here gets the old history
instead of a duplicate. The old campaign → BDM rules become campaign rules, and every row of every old table (also
the payments ledger, bookings, menus and logs) is kept as it was in an archive, browsed in **CRM Admin → Old CRM
Archive** (plain-text passwords and API tokens are blanked). `--skip-refresh` adds only what is missing.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Local database + the app (website and API), watching for changes |
| `pnpm test` | API test suite (vitest + supertest, including the phone app's requests) against a throwaway PostgreSQL |
| `pnpm typecheck` | Typecheck the whole app |
| `pnpm db:local` | Run a local PostgreSQL for development |
| `pnpm db:seed` | Demo data and the quotation catalog |
| `pnpm db:migrate` | Apply pending migrations (deployments do this automatically) |
| `pnpm migrate:vti` | Import the former VTI ERP (see above) |

More in `apps/web`: `pnpm db:generate` (create a migration after editing `src/server/db/schema.ts`),
`pnpm db:studio` (Drizzle Studio), `pnpm setup:admin` (create/update the super-admin account),
`pnpm deploy` (migrations + default roles and settings against `DATABASE_URL`).

## Demo Accounts (created by `pnpm db:seed`)

| Username | Password   | Role        |
|----------|------------|-------------|
| adarsh   | admin123   | Super Admin |
| dheeraj  | admin123   | Super Admin |
| aditi    | admin123   | Super Admin |
| shital   | emp123     | Team Member |
| poojan   | emp123     | Team Member |
| deveng   | client123  | Client      |
| hqtech   | client123  | Client      |

Change these passwords (sidebar → **Change password**) before using real data.

## Project Structure

```
voice-tunes-india/
├── apps/
│   ├── web/                           # The whole product: Next.js website + API, deployed to Vercel
│   │   ├── src/app/(dashboard)/       # CRM, projects, HR… pages
│   │   ├── src/app/(dashboard)/(erp)/ # quotations, payments, catalog, admin pages
│   │   ├── src/pages/api/[...path].ts # hands every /api request to the Express app below
│   │   ├── src/server/                # the API: Express routes, Drizzle schema, services, jobs
│   │   │   ├── routes/                # CRM, calls & after-call form, projects, tasks, HR, invoices…  (/api/*)
│   │   │   ├── erp/                   # quotations, pricing, payments, catalog, roles, settings (/api/v1/*)
│   │   │   ├── jobs/                  # lead sync, Exotel status, reminders (runner.ts schedules them)
│   │   │   └── scripts/               # deploy, seed, db:local, migrate:vti
│   │   ├── drizzle/                   # SQL migrations
│   │   ├── test/                      # vitest + supertest on a real PostgreSQL
│   │   └── vercel.json
│   └── mobile/                        # Android dialer, call sync and after-call form
├── docs/                              # Architecture docs
├── pnpm-workspace.yaml
└── turbo.json
```

## Roles and permissions

Every user holds one role. The built-in roles are `SUPER_ADMIN`, `MANAGEMENT`, `PROJECT_MANAGER`,
`SALES` (BDM), `HR`, `TEAM_MEMBER`, `DEVELOPER`, `DESIGNER`, `MARKETING`, `ADS_TEAM`, `SUPPORT` and `CLIENT`;
more can be created in **Configuration → Roles & Permissions**.

- The CRM, project, marketing and client-portal screens follow each built-in role's fixed access.
- Quotations, payments, the catalog, company settings and the activity log are governed by **permissions**
  (e.g. `quotations.create`, `quotations.view_all`, `artists.assign`, `pricing.manage`) that are edited per
  role. Super Admin and Management always hold all of them.
- HR screens are open to `SUPER_ADMIN`, `MANAGEMENT` and `HR`, and to any role granted `employees.view` /
  `employees.manage`, `departments.manage` or `designations.manage`.
- Only holders of `users.manage` (Super Admin, Management) can give someone the Super Admin or Management role.
- Changing a password or role, or deactivating an account, signs that user out everywhere.

Sign in with a **username, email address or employee ID** (e.g. `VTI-0003`).

## How the merged modules fit together

- **One list of services.** The CRM's service master and the quotation catalog are the same records
  (**Catalog & Pricing → Services**): category, sub category and list price for leads; quotation fields,
  artists and pricing rules for quotations.
- **Leads → quotations.** Open a lead and choose **Create quotation**: the client details are filled in and
  the quotation stays linked to the lead, which lists its quotations.
- **Employees and logins.** **HR → Employee Details** holds everything about an employee (department,
  designation, salary, bank details) and their login: role, username and password. Blank employee IDs are
  generated (`VTI-0001`, …). Only active employees can sign in.
- **Quotations** are numbered per day (`QT-17-09-2026-0001`, prefix in Company Settings), priced by the server
  from the pricing rules (highest priority, then the most specific rule), issued with or without GST, printed
  on the Voice Tunes India letterhead (`apps/web/public/media/Letter-Head.jpg`) and locked once accepted or
  cancelled. Lines keep a snapshot of the names they were priced with.
- **Video editing** reserves the editor choice: without `artists.assign` a line prices at the standard rate
  (a rule with no artist) until coordination assigns the editor from the quotation dashboard.
- **Payments** are recorded against quotations with a proof screenshot (JPG/PNG/WebP/PDF, up to 4 MB on Vercel,
  stored in Cloudflare R2), then marked complete once everything is received.
- **Call recordings** — with **Record calls** switched on, the phone app records each connected call itself, matches
  it to the call and uploads it (straight to R2). The CRM converts it to text in the language that was spoken and writes
  a short English summary; both show on the **Call Log** (Transcript button) and in the lead's timeline. Company-line
  (Exotel) recordings are transcribed the same way. BDMs see recordings of their own calls and leads; admins see all.
  On Vercel, uploads wait on the phone until the R2 settings are added; nothing is lost in the meantime.
- **AI Assistant** (Super Admin, sidebar → Overview) — ask about leads, calls and what customers said on them,
  follow-ups, BDM performance, quotations, payments, projects or HR, in any language; press the mic to ask by voice.
  Answers come from live read-only database queries (passwords and tokens are never readable); each answer lists
  what it looked up.
- **Download DB** now also exports quotations, lines, payments, pricing rules, artists and the activity log.
