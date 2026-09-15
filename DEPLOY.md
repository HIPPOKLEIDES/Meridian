# Putting Meridian online

Meridian works fine as a local-only app. Going online adds three things:

- **Accounts:** email and password.
- **Sync between devices:** it keeps working offline and catches up later.
- **Shared projects:** friends can view or edit, and tasks can be assigned to them.

Two free services do the work:

| Piece | What it does | Suggested |
| --- | --- | --- |
| **Database & accounts** | Stores synced data, signs people in, enforces who can see what | [Supabase](https://supabase.com) (free tier) |
| **Website hosting** | Serves the app itself (plain static files) | [Netlify](https://www.netlify.com), [Cloudflare Pages](https://pages.cloudflare.com) or [Vercel](https://vercel.com) (free tiers) |

Setup takes about 20 minutes and nothing needs installing beyond what's already here.

---

## 1. Create the Supabase project

1. Sign up at supabase.com and click **New project**.
   - Pick a region close to you (e.g. *East US*).
   - Save the database password somewhere safe; Meridian doesn't need it.
2. Open **SQL Editor**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. It sets up:
   - the tables,
   - the security rules,
   - the sharing functions,
   - the private `assets` bucket for note images,
   - live updates.

   Running it again later is safe; do that whenever the file changes.
3. Under **Authentication → Sign In / Providers → Email**:
   - Keep **Email** enabled.
   - Turn **Confirm email** on. Email invites only work for confirmed addresses, which stops someone from claiming an invite by signing up with a friend's address.
   - Set the minimum password length to 8.
4. Under **Authentication → URL Configuration**, set both of these to your app's address once you know it (step 3). They're where confirmation and password-reset links send people.
   - **Site URL**
   - **Redirect URLs**

   Add `http://localhost:5178` to Redirect URLs as well, for development.
5. **Email delivery.** Supabase's built-in mailer is for testing only: it sends just a few emails per hour.
   - Before inviting friends, connect your own SMTP provider under **Authentication → Emails → SMTP settings**. [Resend](https://resend.com)'s free tier works well.
   - Otherwise sign-up confirmations and password resets may not arrive.
6. Under **Project Settings → API** (or **API Keys**), copy:
   - the **Project URL**,
   - the **anon** (or **publishable**) key.

   The anon key is meant to be public; the security rules protect the data. **Never** use the `service_role` / secret key in the app.

## 2. Try it locally (optional)

```bash
cp .env.example .env.local   # then paste the URL and anon key into .env.local
npm run dev
```

Open Settings → **Account & sync** and create an account.

To test without Supabase at all, run a local stand-in and connect Settings → Account & sync to it:

```bash
npm run dev:cloud
```

- Address: `http://localhost:54321`.
- Anon key: any 20+ characters.
- It confirms emails instantly and doesn't support live updates, so changes arrive by polling every few seconds.

## 3. Publish the app

The app is static files built into `dist/`. Set the two environment variables, then build.

**Netlify with GitHub** (the app updates whenever you push):

1. Push this folder to a GitHub repository. `.gitignore` already excludes `.env.local`.
2. In Netlify: **Add new site → Import an existing project**, then pick the repository.
3. Settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. **Site configuration → Environment variables:** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then redeploy.

**Without GitHub:**

1. Put the values in `.env.local` and run `npm run build`.
2. Drag the `dist` folder onto [app.netlify.com/drop](https://app.netlify.com/drop).
3. Repeat both steps for each update.

Cloudflare Pages and Vercel work the same way: build command `npm run build`, output `dist`, and the same two variables.

Then go back to Supabase step 1.4 and enter the site's address (e.g. `https://meridian-phil.netlify.app`).

## 4. Your phone

Open the site on your phone and add it to your home screen:

- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** menu → **Install app**

It opens full-screen, works without signal and syncs when back online. Sign in with the same account.

The first time you sign in on a device that already has data, Meridian asks what to do with it:

- **Upload it** into your account.
- **Replace it** with your account's data.
- **Cancel** and sign out.

## 5. Sharing with friends

Open a project and click **Share**. You can:

- **Invite by email.** They join automatically the next time they sign in with that address. Meridian doesn't send the email, so tell them.
- **Create an edit or view link.** Anyone who opens it and signs in joins the project. Links expire after 14 days and can be revoked.

What each role can do:

| Role | Can do |
| --- | --- |
| **Owner** | Everything, including inviting, changing roles, removing people and deleting the project |
| **Editor** | Change tasks, the task map and notes (including boards and images); assign tasks |
| **Viewer** | Look only. Edits are undone on the spot. |

What members see:

- Only that project: its tasks, task map and notes.
- Never your habits, time, health, finances, journal, goals or other projects.

Tasks assigned to someone appear on *their* Today and Calendar. In a shared project, unassigned tasks show only for whoever created them.

---

## What's protected, and how

- **Row-level security** decides what each account can read and write. Every rule is tested against real Postgres by `npm run test:schema`.
- **The journal** can be end-to-end encrypted (Journal → Privacy):
  - The passphrase never leaves your device.
  - The server only ever stores ciphertext.
  - Other devices ask for the same passphrase.
  - A forgotten passphrase cannot be recovered.
- **Everything else** (health, finances, notes…) is private to your account.
  - It's stored readable in your Supabase database, which Supabase encrypts on disk.
  - You, as the project's admin, can see it in the Supabase dashboard.
- **Personal API keys** stay on each device: the USDA key isn't synced, and Google sign-in tokens are never stored.

## Keeping it running

- **Backups:** the free tier has no point-in-time restore. Settings → **Export backup** now and then is still your safety net.
- **Free-tier limits:** Supabase caps database and storage size, and free projects can be paused after a period of inactivity. Check their current pricing page; unpausing is one click in the dashboard.
- **Updating Meridian:**
  1. Re-run `supabase/schema.sql` if it changed.
  2. Redeploy the site.

  Installed phone apps pick up the new version on their next launch.
- **Tests:** `npm test` runs:
  - the sync-engine tests (two devices, offline conflicts, sharing, roles),
  - the database security tests.
