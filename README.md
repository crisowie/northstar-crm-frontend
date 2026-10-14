# Northstar outreach and CRM frontend

React + Vite client for Northstar CRM. From this folder, run:

```powershell
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173` by default. Demo mode works locally without Supabase credentials.

The NestJS API is in the sibling project `../otax-internal-server`. Start it with `npm run dev:server`, or run `npm run start:dev` from that folder. The API listens on `http://localhost:5000/api` by default.

For Supabase authentication, copy `.env.example` to `.env.local` and set `VITE_AUTH_MODE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_URL`. Never put the Supabase service role key or Google OAuth client secret in this folder.

Gmail sending, reply sync, and on-demand thread viewing are configured on the API. Outreach lists show one conversation per contact; each sent message is still tracked for analytics, but replies and follow-ups are grouped into the same chat. Open a conversation to read its history and reply at the bottom. The **AI** action in the reply box drafts a response using the recent conversation; it only fills the editable input and never sends automatically. Gmail replies are sent into the appropriate Gmail thread; other providers keep sent replies grouped in CRM conversation history. Full Gmail conversation viewing requires approving the Gmail read-only scope and reconnecting the mailbox. See the API README for Google OAuth setup, database migrations, and the Cal.com webhook setup used to record booked, cancelled, and rescheduled meetings. Click tracking and Cal.com webhooks require the API to be reachable over HTTPS through `PUBLIC_API_URL`.

AI email drafts use Groq. Apply API migration `006_groq_drafting.sql`, then set `GROQ_API_KEY` on the API or add a workspace key under Settings → AI email drafting and test it. The signed-in display name is editable under Settings → Your profile and is also used as the default email signature.

## Render preview deployment

This project includes a Render Blueprint for a free static-site preview. Both services pin Node 24.21.0 for deployment and declare the supported Node range in `package.json`. The API is a separate sibling project (`../otax-internal-server`) with its own `render.yaml`; deploy the frontend and API as separate services from their respective repository roots. Set `VITE_API_URL` to the public API URL ending in `/api`, and set the Supabase URL/anon key in the frontend service. Set `FRONTEND_ORIGIN`, `PUBLIC_API_URL`, Supabase credentials, and the stable encryption key in the API service. Add the deployed API callback URL to the Google OAuth client.

Supabase remains the authoritative CRM database. Render free web services sleep after 15 minutes without inbound traffic and have ephemeral filesystems; free Render Postgres expires after 30 days and has no backups, and free Key Value is in-memory. Use Supabase backups and test restore procedures. The current application sends immediately on user action and does not schedule campaigns or follow-ups. See the API README for provider setup, event limitations, Resend's opt-in-only policy, and production constraints.
