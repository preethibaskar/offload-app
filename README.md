# Offload

An invite-only brain-dump app: throw everything on your mind into a tray,
and Claude sorts it into Today / This Week / Someday / Waiting On.

## How access control works

There is no public sign-up form. Accounts only exist if you (the admin)
create them:

```
npm run invite -- someone@example.com
```

This uses Supabase's admin API to create the user and email them a
sign-in link. The login screen (`src/components/Login.jsx`) also passes
`shouldCreateUser: false`, so even if someone types in a random email,
Supabase refuses to create an account or send a link for it — invite is
the *only* way in.

## One-time setup

1. **Create a Supabase project** at supabase.com.
2. In the SQL editor, run `supabase/schema.sql` — this creates the
   `kv_store` table and the Row Level Security policy that keeps each
   user's data private.
3. In **Project Settings → API**, copy:
   - the Project URL → `VITE_SUPABASE_URL`
   - the `anon` `public` key → `VITE_SUPABASE_ANON_KEY`
   - the `service_role` `secret` key → `SUPABASE_SERVICE_ROLE_KEY`
     (keep this one out of git — see `.gitignore`)
4. Copy `.env.example` to `.env` and fill in those three values, plus an
   `ANTHROPIC_API_KEY` from console.anthropic.com.
5. (Optional, extra safety) In Supabase **Authentication → Settings**,
   turn off "Allow new users to sign up" so account creation is only
   ever possible through the admin invite API.

## Local development

```
npm install
npm run dev
```

Invite yourself first so you have something to log in with:

```
npm run invite -- you@example.com
```

Note: `npm run dev` serves the frontend only. The `/api/sort` serverless
function needs the Vercel CLI to run locally (`npx vercel dev`) or you can
just test the AI sort feature after deploying.

## Deploying

1. Push this repo to GitHub.
2. Import it into Vercel (vercel.com → New Project → your repo).
3. In the Vercel project's **Environment Variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
4. Deploy. You'll get a URL like `offload-yourname.vercel.app`.
5. Invite people:
   ```
   npm run invite -- friend@example.com
   ```
   They'll get an email with a link that signs them straight in.

## Notes / next steps

- `api/sort.js` has a basic in-memory rate limit (30 sorts/hour/user) to
  protect your Anthropic quota. It resets on cold start, so it's a soft
  limit — fine to start with, worth replacing with a real store (a
  Supabase table, or Upstash) if this gets real usage.
- To revoke someone's access, delete their user from
  **Supabase → Authentication → Users**. Their rows in `kv_store` are
  deleted automatically (the table's foreign key is `on delete cascade`).
