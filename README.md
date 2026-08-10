# Offload

An invite-only brain-dump app: throw everything on your mind into a tray,
and Claude sorts it into Today / This Week / Someday / Waiting On.

## How access control works

There is no public sign-up form. Accounts only exist if you (the admin)
add them:

```
npm run invite -- someone@example.com
```

This creates the user in Supabase **without sending email**. On the login
screen they enter that same address and click **Continue** — the app checks
the allowlist server-side (`api/login.js`) and signs them in immediately.
Unknown emails get: *"You haven't been invited yet."*

**Note:** Sign-in only checks that the email is on the allowlist — there is
no second factor (no magic link, no password). Fine for a small trusted group;
don't use this model for open/public apps.

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
   ever possible through `npm run invite`.

## Local development

```
npm install
npm run dev
```

Add yourself first so you have something to log in with:

```
npm run invite -- you@example.com
```

Then open the app, enter that email, and click **Continue**.

Note: `npm run dev` wires up `/api/login` and `/api/sort` locally via
`vite.config.js`. For full Vercel parity you can also use `npx vercel dev`.

## Deploying

1. Push this repo to GitHub.
2. Import it into Vercel (vercel.com → New Project → your repo).
3. In the Vercel project's **Environment Variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
   **Important:** Vite embeds `VITE_*` vars at build time. After adding or
   changing them, you must **Redeploy** (Deployments → Redeploy) — saving
   env vars alone is not enough.
4. Deploy. You'll get a URL like `offload-yourname.vercel.app`.
5. Add people (no email sent):
   ```
   npm run invite -- friend@example.com
   ```
   Share your app URL — they sign in with that email on the login screen.

## Testing sort accuracy

```
npm run eval
```

Runs `eval/dataset.json` (70 hand-labeled examples across all four
categories) through the exact same prompt `api/sort.js` uses, and prints:

- overall + per-category accuracy
- a confusion matrix (which categories get mixed up with which)
- every mismatch, so you can see the actual wrong answers, not just a number
- response/parse errors, if any

Check consistency (does the model give the same answer to the same input
every time?) by running more calls per item:

```
CONSISTENCY_RUNS=3 npm run eval
```

Re-run this after any prompt change (`shared/sortPrompt.js`) to see whether
it actually helped. Add new rows to `eval/dataset.json` as you discover
real-world miscategorizations — that's the highest-value use of this file
over time.

## Real-world accuracy: correction logging

Whenever someone changes the category the AI assigned to an item, that gets
logged to the `corrections` table (see `supabase/schema.sql`) with the item
text, the AI's original category, and what the person corrected it to. This
is a better accuracy signal than any offline test set, because it's your
actual users' actual dumps.

To review it, query Supabase directly (SQL editor or table view) — the app
itself never reads this table back, by design (see the RLS policy comment
in `schema.sql`). A useful starting query:

```sql
select ai_category, corrected_category, count(*)
from corrections
group by 1, 2
order by 3 desc;
```

If a particular `ai_category -> corrected_category` pair keeps showing up,
that's your next few-shot example to add to the prompt, and a good
candidate to add to `eval/dataset.json` too.

## Notes / next steps

- `api/sort.js` has a basic in-memory rate limit (30 sorts/hour/user) to
  protect your Anthropic quota. It resets on cold start, so it's a soft
  limit — fine to start with, worth replacing with a real store (a
  Supabase table, or Upstash) if this gets real usage.
- To revoke someone's access, delete their user from
  **Supabase → Authentication → Users**. Their rows in `kv_store` are
  deleted automatically (the table's foreign key is `on delete cascade`).
