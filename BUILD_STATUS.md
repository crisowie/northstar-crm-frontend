# Outreach CRM provider and deployment work

## Phase A — existing architecture inspection

Status: complete. No production data, credentials, or database rows were changed during inspection.

### Project layout and current design

- Frontend project: `C:\Users\HP\Desktop\otax-internal-tool`. React 19 + Vite + TypeScript, with Supabase Auth and a NestJS API client. Its `.env.example` contains the public Supabase URL/anon key and local API URL; private keys are documented as API-only.
- API project: sibling directory `C:\Users\HP\Desktop\otax-internal-server`. NestJS + TypeScript + Supabase JS service-role client. It owns the Gmail OAuth callback, sends, reply checks, click redirect, and health endpoint.
- Database: Supabase Auth plus `crm_settings`, CRM domain tables, `crm_email_accounts`, `crm_outreach_messages`, and `crm_outreach_links`, created by migrations 001–003. Outreach data and encrypted Gmail tokens are accessed by the authenticated API. The existing click-recording function increments link and message counters.
- Existing CRM features: contacts, companies, jobs, opportunities, tasks, notes, activities, workspace settings, and analytics remain in the existing frontend/API data model. Jobs are related to opportunities and contacts; outreach messages currently link to a contact and optional opportunity.
- Existing Gmail flow: OAuth requests `gmail.send` and `gmail.metadata`; refresh/access tokens are AES-256-GCM encrypted using `GMAIL_TOKEN_ENCRYPTION_KEY`. Sending creates a CRM message record, wraps email links through the API, calls Gmail `messages.send`, then records Gmail message/thread IDs. Reply sync reads metadata headers only from each saved Gmail thread and matches sender/time. Clicks use stable per-link tokens and `PUBLIC_API_URL` redirects.
- No background job runner, campaign scheduler, or email event/webhook model currently exists. Sends are individual immediate sends. The app has no explicit hard-bounce/unsubscribe suppression fields or sending pause control today; adding provider support must not claim these safeguards already exist.

### Preservation and deployment risks

- Provider IDs must be added alongside the legacy Gmail IDs; existing rows and click URLs must remain readable. Migration 004 should be additive and never drop/recreate existing tables.
- SES and Resend are delivery APIs, not inboxes. Reply checks remain a separate Gmail mailbox capability; API sends must not imply inbox sync or delivery confirmation.
- Current Resend AUP explicitly prohibits unsolicited email, including cold outreach, and requires explicit opt-in for mailing lists. The product must gate Resend sends to opted-in recipients and must not describe Resend as suitable for cold prospecting. Source: [Resend Acceptable Use Policy](https://resend.com/legal/acceptable-use).
- SES events require an SES configuration set and an event destination (such as SNS); a successful send response only means SES accepted the request. Source: [SES event destinations](https://docs.aws.amazon.com/ses/latest/dg/event-destinations-manage.html).
- Gmail API scope and user-data requirements remain applicable; `gmail.metadata` is restricted and reply polling does not fetch message bodies. Source: [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).
- Render free web services sleep after 15 minutes without inbound traffic, have ephemeral filesystems, free Postgres expires after 30 days and has no backups, and free Key Value is in-memory. No durable worker/scheduler can be promised on that tier. Source: [Render free deployment limits](https://render.com/docs/free).
- Frontend and API are separate sibling projects with no Git metadata in either directory. Render deployment therefore needs separate frontend/API service definitions and a configured API URL. Supabase remains the authoritative database; Render free Postgres should not replace it.
- The API startup currently allows volatile in-memory fallback when Supabase is not configured, which is demo-only and unsuitable for a deployed CRM. Production validation must require durable Supabase and encryption configuration without requiring credentials for inactive email providers.

## Implementation plan

1. Add an additive database migration for encrypted provider settings, provider/message identifiers, normalized events, idempotency, and safe event-to-message indexing.
2. Introduce an explicit provider interface/capability matrix and migrate Gmail sending through it while preserving OAuth, IDs, tracking, and reply sync.
3. Add per-user provider settings, environment defaults, health/test operations, and default outbound provider selection. Server-managed encrypted credentials take precedence for that user/provider; environment values are fallback defaults. Secrets never return to the browser.
4. Add SES using AWS SDK v3 and authenticated SNS event processing; add Resend using its official API with explicit opt-in enforcement.
5. Normalize supported provider and tracking events, expose source/capability information, and add provider settings UI without replacing the CRM settings or history.
6. Add separate Render blueprints and deployment/migration/backup instructions for the frontend and API, preserving Supabase as the durable store.
7. Add regression and provider tests, run type checks/lint/build/migration checks where available, and update this file with exact results and remaining configuration steps.

## Exact commands to resume

- Frontend: `cd C:\Users\HP\Desktop\otax-internal-tool; npm run build`
- API: `cd C:\Users\HP\Desktop\otax-internal-server; npm run build`
- Local frontend: `npm run dev`
- Local API: `npm run start:dev`
- Apply migrations in order through the Supabase SQL editor, starting with any migration number not yet applied; never re-run destructive database resets.

## Progress log

- Phase A: inspected the frontend and API structure, package configuration, `.env.example` files, migrations 001–003, Gmail OAuth/token handling, send/reply/click flows, workspace model, and settings UI. Read current official Resend, AWS SES, Google Gmail, and Render documentation. No tests run yet.

## Phase B — configurable outreach providers and Render preparation

Status: implemented in the frontend and sibling API project. No live emails were sent, no production provider credentials were entered, no database migration was applied, and no Render deployment was created.

### Implemented

- Added Gmail, Amazon SES, and Resend provider adapters. Existing Gmail OAuth/token encryption, Gmail message/thread IDs, metadata-only reply sync, and tracked-click URLs remain intact.
- Added encrypted per-workspace provider settings, environment fallback configuration, per-workspace default provider, per-message provider selection, test connection, capability/status reporting, last successful operation and last provider error.
- Added additive migration `004_email_providers.sql` for provider metadata, source tracking, idempotency, normalized events, suppression, pause state, and per-provider health. Existing messages, Gmail IDs, click counts, and tracked links are preserved.
- Added SES SNS signature verification and event mapping, Resend signed-webhook verification, deduplicated provider events, provider-supported analytics, bounce/complaint suppression, and a workspace-wide send pause.
- Required explicit recipient opt-in for every Resend send. Resend must not be used for unsolicited outreach; its policy forbids unsolicited email, including cold outreach. Source: [Resend Acceptable Use Policy](https://resend.com/legal/acceptable-use).
- Added provider setup, capabilities, suppression controls, and pause/resume UI under Settings; added message-level provider selection and event analytics to Outreach.
- Added separate Render blueprints for the static frontend and API, pinned Node 24.21.0 for both, and documented Supabase as the durable data store. Render free services sleep after inactivity and have ephemeral filesystems, so the documentation does not promise background scheduling or durable local storage. Source: [Render free deployment limits](https://render.com/docs/free).
- Added API deployment, OAuth, SES/SNS, Resend webhook, migration, and backup instructions. The app continues to send synchronously and does not include a campaign scheduler or follow-up worker.

### Verification

- Frontend: `npm run build` — passed. Vite reports the existing single JavaScript bundle exceeds its 500 kB advisory threshold; it does not fail the build.
- API sibling project: `npm ci --ignore-scripts` — passed with 0 reported vulnerabilities; `npm run build` — passed; `npm test` — 12 passed, 0 failed.
- Regression coverage includes Gmail send/reply compatibility, provider capabilities, duplicate-send prevention, pause/suppression checks, Resend opt-in enforcement, signed webhook verification, event deduplication, and additive migration shape.
- The migration has not been run against Supabase. Apply it manually only after confirming migrations 001–003 and take a database backup first. Configure OAuth/provider credentials and webhook subscriptions in the target environment before sending real email.
