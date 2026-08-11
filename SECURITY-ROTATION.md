# Rotating the exposed credentials

These credentials were flagged as exposed in Phase 1 and are still live. This
is the one item on the gap list that no code change closes — every other fix
in the repo is bypassed by whoever holds `MONGO_URI`.

Nothing is committed: `.env` has never appeared in either repo's history, and a
scan for connection strings and API-key shapes across all tracked files in both
repos comes back empty. The exposure is not the git history — it is that these
values have been shared or handled outside it, and they have not changed since
they were flagged.

Work top to bottom. **Do the JWT secrets last** — they are the only ones that
sign every user out.

---

## Before you start

Each credential lives in **four** places. Miss one and it fails somewhere
non-obvious, usually hours later.

| Where | How |
|---|---|
| The provider (Atlas, Cloudinary, Google, Gmail) | The provider's own console |
| Vercel project `fitai-backend`, **Production** | `vercel env rm NAME production` then `vercel env add NAME production` |
| Vercel project `fitai` (frontend), **Production** | Only `VITE_API_URL` lives here — no secrets |
| Local `.env` files | `backend/.env`, and the root `.env` |

Two things about the local files that bite:

- There is a `.env` at the **project root** as well as in `backend/`. The root
  one holds the Atlas URI, all three JWT secrets and the Cloudinary and Google
  secrets. It is covered by a root `.gitignore` added on 2026-07-21, but it is
  easy to forget it exists and leave dead credentials in it.
- Vercel inlines `VITE_*` at **build** time. Backend variables are read at
  runtime, so a backend rotation needs a redeploy only to pick up the new value
  — but it does need one.

After any backend variable changes:

```bash
cd backend && npx vercel@latest --prod
curl -s https://fitai-backend.vercel.app/health
```

`/health` reports `database: connected`, which is the fastest confirmation that
the new `MONGO_URI` works.

---

## 1. Cloudinary — start here

Lowest blast radius: nothing is signed with it, and only image upload uses it.
A good rehearsal for the process.

1. Cloudinary console → Settings → Access Keys → generate a new key pair.
2. Update `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` in Vercel
   (`fitai-backend`, production) and in both local `.env` files.
   `CLOUDINARY_CLOUD_NAME` does not change.
3. Redeploy, then upload an avatar from the profile page.
4. Only then disable the old key pair in the console.

**Breaks if wrong:** avatar upload fails. Nothing else.

---

## 2. Gmail app password

1. Google Account → Security → 2-Step Verification → App passwords.
2. Create a new one, update `EMAIL_PASS`, redeploy.
3. Trigger a real send — request a password reset for an address that exists.
4. Revoke the old app password.

**Breaks if wrong:** password reset and verification emails stop arriving.
Note that `forgotPassword` deliberately swallows send failures so the response
cannot be used to enumerate accounts — so **a broken mailer looks exactly like
success from the outside**. Check the Vercel function logs for the
`Failed to send` error rather than trusting the HTTP response.

---

## 3. Google OAuth client secret

1. Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 client
   → "Add secret", which lets both work briefly.
2. Update `GOOGLE_CLIENT_SECRET`, redeploy.
3. Test **both** flows — they are separate redirect URIs and either can be
   missed:
   - sign-in: `https://fitai-backend.vercel.app/auth/google/callback`
   - calendar sync: `https://fitai-backend.vercel.app/calendar-sync/google/callback`
4. Delete the old secret.

`GOOGLE_CLIENT_ID` does not change, so no redirect URIs need re-registering.

**Breaks if wrong:** Google sign-in fails at the callback, and calendar sync
stops pulling events. Verification trick that needs no login: follow the
sign-in URL to `accounts.google.com` and read the returned HTML — an
unregistered or mismatched client yields a `redirect_uri_mismatch` page, a
working one yields `<title>Sign in - Google Accounts</title>`. **The error page
returns HTTP 200**, so the status code proves nothing; you must read the body.

---

## 4. MongoDB Atlas

The important one. With the current URI, someone has full read/write on every
user's data and none of the app's own authorization applies.

1. Atlas → Database Access → **create a second user** with the same role. Do
   not edit the existing one; you want a rollback that does not involve
   re-creating anything.
2. Update `MONGO_URI` in Vercel and both local `.env` files.
3. Redeploy. Confirm `/health` returns `database: connected`.
4. Exercise a write, not just a read — log a set, or save a measurement.
5. Delete the old database user in Atlas.

While you are in there: check **Network Access**. If it still allows
`0.0.0.0/0`, the URI is the only thing standing between the internet and the
database, which is what makes this rotation urgent rather than tidy.

**Breaks if wrong:** everything. `/health` says so immediately.

---

## 5. JWT secrets — last

Rotating these invalidates every token signed with the old ones. Every signed-in
user is logged out and must sign in again. That is not avoidable, so do it when
a forced sign-out costs least.

Three variables, and `configuration.ts` requires all three at boot:

- `JWT_ACCESS_SECRET` — signs access tokens
- `JWT_REFRESH_SECRET` — signs refresh tokens
- `JWT_SECRET` — read by `config/configuration.ts` and listed as required,
  though nothing signs with it. **Rotate it anyway**: it must be present or the
  app refuses to start, and leaving a known-exposed value in place because it
  looks unused is how it comes back later.

Generate each separately — never reuse one value across two of them:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

1. Update all three in Vercel, redeploy.
2. Sign in fresh and confirm you get a session.
3. Confirm the refresh path works: wait out the 15-minute access token, or set
   its TTL shorter locally, and check that the app keeps working without a
   re-login.
4. Update both local `.env` files.

**Breaks if wrong:** every request 401s. Existing sessions 401 regardless —
that is expected, and the frontend's interceptor will send people to the login
page rather than showing errors.

---

## After all five

- [ ] Old Cloudinary key pair disabled
- [ ] Old Gmail app password revoked
- [ ] Old Google client secret deleted
- [ ] Old Atlas database user deleted
- [ ] All three JWT secrets replaced with independently generated values
- [ ] Root `.env` and `backend/.env` both updated
- [ ] Atlas Network Access reviewed
- [ ] `/health` reports `database: connected`
- [ ] Sign-in, Google sign-in, avatar upload, password reset all exercised

Rotation is only finished once the **old** credentials are revoked. Until then
both sets work and nothing has actually been closed.

---

## Keeping it closed

- Treat every value in `.env` as compromised the moment it is pasted anywhere
  outside the machine it runs on — chat, a ticket, a screenshot.
- Prefer `vercel env pull` over copying values by hand.
- The root `.env` exists because the project root has its own `node_modules`.
  Anything added there needs a `.gitignore` entry checked, not assumed —
  that file went uncovered by any ignore rule until 2026-07-21.
