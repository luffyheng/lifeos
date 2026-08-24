# Life Agent PWA

A mobile-first, ChatGPT-like personal operating system. The MVP includes chat, automatic life-area tagging, durable memory extraction, daily check-in and weekly review prompts, goals, trend views, Supabase authentication/data storage, and a server-side OpenAI integration.

## What works immediately

Open the app without configuration to use **demo mode**. Chat, goals, memory chips, trend cards, navigation, responsive layout, and offline caching all work locally. Demo data is kept only in the current browser.

After Supabase is configured, AI calls go through a Supabase Edge Function. `OPENAI_API_KEY` is never included in browser code.

## Local preview

Requires Node.js 18 or newer.

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

Validation and production build:

```bash
npm run check
npm run build
```

The deployable static app is generated in `dist/`.

## Supabase setup

1. Create a Supabase project.
2. Install the Supabase CLI and sign in.
3. Link this folder to the project:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

4. Add server-only secrets and deploy the Edge Function:

```bash
supabase secrets set OPENAI_API_KEY=YOUR_KEY OPENAI_MODEL=gpt-5.4-mini
supabase functions deploy life-agent
```

5. In Supabase Auth settings, add the local and deployed origins to the redirect allow list. Copy `public/config.js` and fill in the project URL and **public anon key**:

```js
window.LIFE_AGENT_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY",
  edgeFunctionName: "life-agent"
};
```

The anon key is designed for browser use; data access is protected by row-level security. Never put the service-role key or OpenAI key in this file.

## Firebase Hosting (optional)

Firebase is only used to host the static PWA. Supabase remains the database, authentication, storage, memory, and server-function layer.

Production URL: https://life-agent-luffy.web.app

```bash
npm run build
firebase login
firebase use --add
firebase deploy --only hosting
```

Any static host can serve `dist/`, including Cloudflare Pages, Netlify, or Vercel.

## Architecture

```text
Browser PWA
  ├── local demo state / offline cache
  ├── Supabase Auth + PostgREST (RLS protected)
  └── Supabase Edge Function
        ├── recent chat + goals + memories
        ├── OpenAI Responses API (structured JSON)
        └── saves messages, tags, signals, memories
```

Core tables are intentionally extensible: `profiles`, `conversations`, `messages`, `memories`, `goals`, `daily_checkins`, `weekly_reviews`, and `metric_entries`. Flexible `metadata` JSON fields allow integrations such as Strava, bank exports, calendar signals, or custom templates without redesigning the base schema.

## Security checklist

- OpenAI calls occur only inside `supabase/functions/life-agent`.
- Every user-owned table has row-level security.
- The browser receives only the Supabase anon key.
- The Edge Function validates input length and uses structured model output.
- For production, restrict the Edge Function CORS origin to your deployed domain and enable normal Supabase JWT verification after the authentication screen is enabled.
- Health and finance content is positioned as reflection/support, not diagnosis or individualized regulated advice.

## MVP next steps

1. Sync the visual dashboard from `daily_checkins`, `weekly_reviews`, and `metric_entries` instead of demo seed data.
2. Add memory confirmation/editing so the user controls what remains remembered.
3. Add scheduled weekly summaries and reminders.
4. Add optional integrations one at a time, starting with the signal that has the clearest value.
