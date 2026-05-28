# Mentor Portal Auth — Setup Guide

The portal is wired up for Supabase auth with email/password + Google sign-in, gated by a pre-approved email allowlist. Follow these steps to make it live.

## 1. Create a Supabase project (~5 min)

1. Go to <https://supabase.com> and sign in (free account).
2. Click **New project** → name it `headstart-mentor-portal` (or similar).
3. Choose a region close to Australia (Sydney recommended).
4. Set a strong database password (save it in a password manager).
5. Click **Create new project**. Wait ~1 minute while it provisions.

## 2. Copy your project keys

1. In the Supabase dashboard for your project, open **Settings → API**.
2. Copy these two values:
   - **Project URL** — looks like `https://xxxxxxxxxxxx.supabase.co`
   - **anon public** key — long string starting with `eyJ...`
3. Open `mentor-portal/auth.js` and paste them into:
   ```js
   export const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
   export const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
   ```
4. While you're in `auth.js`, edit the `ALLOWED_MENTOR_EMAILS` array — add every mentor's email (lowercase) that should be allowed to sign up. Add more later as you onboard mentors.

The anon key is meant to be public — it's safe to commit to the repo. Real security comes from Supabase Row Level Security, which we can layer on later.

## 3. Configure email auth settings

In Supabase dashboard, open **Authentication → Sign In / Up**:

- **Enable email signups** — leave on (signup page needs it).
- **Confirm email** — leave on (Supabase sends a confirmation email after signup; mentor clicks link to activate).
- **Site URL** (under URL Configuration) → set to your live domain, e.g. `https://theheadstartmentoring.com`.
- **Redirect URLs** → add:
  ```
  https://theheadstartmentoring.com/mentor-portal/**
  http://localhost:*/mentor-portal/**
  ```
  The first is for production; the second lets you test locally.

## 4. Set up Google sign-in (~10 min)

Two parts: create a Google OAuth client, then paste it into Supabase.

### 4a. Google Cloud Console

1. Go to <https://console.cloud.google.com>.
2. Create a new project (or reuse one). Name it `Headstart Mentor Portal`.
3. Open **APIs & Services → OAuth consent screen**. Choose **External**, fill in:
   - App name: `Headstart Mentor Portal`
   - User support email: your email
   - Developer contact: your email
   - Save and continue through the scopes/test-users screens (defaults are fine).
4. Open **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**
   - Name: `Headstart Mentor Portal — Web`
   - **Authorized JavaScript origins**: add
     - `https://theheadstartmentoring.com`
     - `https://YOUR-PROJECT.supabase.co` (replace with your Supabase URL)
   - **Authorized redirect URIs**: add
     - `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
5. Click **Create**. Copy the **Client ID** and **Client secret** that appear.

### 4b. Supabase — Google provider

1. In Supabase dashboard, open **Authentication → Providers → Google**.
2. Toggle **Enable Sign in with Google**.
3. Paste the **Client ID** and **Client secret** from the previous step.
4. Click **Save**.

## 5. Deploy

The code is already in your repo. Push to Netlify and the login/signup pages will be live at:

- `https://theheadstartmentoring.com/mentor-portal/login.html`
- `https://theheadstartmentoring.com/mentor-portal/signup.html`
- `https://theheadstartmentoring.com/mentor-portal/` — the portal itself, now requires auth.

Any unauthenticated visitor to the portal, onboarding modules, resource hub, or case studies will be redirected to login automatically.

## 6. Add a new mentor

Two ways:

**Self-serve** — Add their email to `ALLOWED_MENTOR_EMAILS` in `auth.js`, push the change, then tell them to go to `/mentor-portal/signup.html` and create an account (with Google or email/password).

**Manually invited** — Open Supabase dashboard → **Authentication → Users → Invite user**. They get a magic link and can set their password.

## 7. Optional hardening (later)

The current setup checks the allowlist client-side. For stronger enforcement (so even a clever user can't bypass), add a Postgres trigger that rejects unknown emails on user creation:

```sql
-- In Supabase SQL editor:
create table public.allowed_mentor_emails (
  email text primary key
);
-- Seed it from your auth.js array:
insert into public.allowed_mentor_emails (email)
values ('fidelhon@gmail.com'); -- add more rows

create or replace function public.enforce_mentor_allowlist()
returns trigger language plpgsql security definer as $$
begin
  if not exists (
    select 1 from public.allowed_mentor_emails
    where email = lower(new.email)
  ) then
    raise exception 'Email % is not on the mentor allowlist', new.email;
  end if;
  return new;
end;
$$;

create trigger enforce_mentor_allowlist
  before insert on auth.users
  for each row execute function public.enforce_mentor_allowlist();
```

This is optional. The client-side check is enough for an internal team.

## Troubleshooting

- **"Could not sign in" with correct credentials**: email might not be confirmed yet. Check inbox/spam for a Supabase confirmation email.
- **Google button does nothing**: check Supabase logs (Authentication → Logs) and the browser console. Most often the redirect URL isn't whitelisted in Supabase or Google.
- **Stuck on a blank page with "auth-ok" never set**: open the browser console — likely the Supabase URL or anon key in `auth.js` is wrong.
- **Allowlist rejects a valid email**: check `ALLOWED_MENTOR_EMAILS` in `auth.js` — entries must be lowercase, no extra spaces.

## Files this auth setup added

```
mentor-portal/
  auth.js            ← Supabase client + allowlist + helpers
  auth.css           ← Login/signup page styling
  guard.js           ← One-line auth check for protected pages
  login.html         ← Sign in (email/password + Google)
  signup.html        ← Create account (email/password + Google)
  SETUP.md           ← This file
```

Protected pages (added a one-line auth guard to each):

- `mentor-portal/index.html`
- `html/mentor-onboarding.html`
- `html/mentor-onboarding-professional-standards.html`
- `html/mentor-onboarding-how-headstart-works.html`
- `html/mentor-onboarding-teachworks-payment.html`
- `html/mentor-onboarding-extra-services.html`
- `html/tutor-resources.html`
- `html/case-studies/*.html` (all 4)
