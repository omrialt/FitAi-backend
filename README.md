# FitAi — Backend API

REST API for **FitAi**, a training and nutrition tracking platform for athletes,
personal trainers, and their clients. It owns everything the app persists:
accounts and roles, training plans and logged sets, nutrition plans, physical
measurements, trainer↔client relationships, and two-way Google Calendar sync.

Built with **NestJS 11**, **MongoDB (Mongoose 8)** and **TypeScript**, deployed
as serverless functions on Vercel.

- **Live API:** https://fitai-backend.vercel.app · [`/health`](https://fitai-backend.vercel.app/health)
- **Frontend:** https://fitai-jade.vercel.app ([repo](https://github.com/omrialt/FitAi-frontend))

---

## What it does

| Domain | Responsibility |
| --- | --- |
| **Auth** | Email/password + Google OAuth 2.0, JWT access/refresh tokens, token blacklist on logout, password reset by email |
| **Users & Admin** | Profiles, `user` / `trainer` / `admin` roles, admin user listing with pagination and filters |
| **Training plans** | Weekly plans → days → exercises → sets, sharing with other users, plan cloning, activation |
| **Nutrition plans** | Meals and macros, sharing, ratings, activation |
| **Physical data** | Weight, body-fat, height and waist readings over time, plus BMI and progress derivations |
| **Progress stats** | Period statistics computed from real readings and logged workouts (see [Known gaps](#known-gaps)) |
| **Current status** | The user's active training plan, active menu and current phase |
| **Trainer connections** | Trainers invite clients; clients accept or decline; either side can disconnect |
| **Calendar sync** | Push training days to Google Calendar and pull the user's Google events back into the weekly view |
| **Recommendations** | Stored training/nutrition/general recommendation records, tagged `ai` or `trainer` |
| **Uploads** | Image uploads to Cloudinary (single and multiple) |

## Tech stack

| | |
| --- | --- |
| Framework | NestJS 11, Express 5 |
| Language | TypeScript 5.7 |
| Database | MongoDB Atlas via Mongoose 8 |
| Validation | Zod (schemas) + `class-validator` global `ValidationPipe` |
| Auth | Passport (`passport-jwt`, `passport-google-oauth20`), `@nestjs/jwt`, bcrypt |
| Security | helmet, CORS allow-list, `express-rate-limit`, compression, cookie-parser |
| Integrations | Google Calendar (`googleapis`), Cloudinary, Nodemailer |
| Docs | Swagger / OpenAPI at `/docs` |
| Tests | Jest + ts-jest |
| Hosting | Vercel serverless (`api/index.ts`) |

---

## Getting started

**Prerequisites:** Node.js 20+, npm, and a MongoDB instance (local or Atlas).

```bash
npm install
cp .env.example .env    # then fill in the values
npm run start:dev
```

The API listens on `http://localhost:3000`. Swagger UI is served at
`http://localhost:3000/docs` (and the raw schema at `/docs-json`).

### Environment variables

Every variable is documented inline in [`.env.example`](.env.example). The app
**fails fast on boot** if any required one is missing — `src/config/configuration.ts`
validates them before Nest starts, so a misconfigured deploy errors immediately
instead of failing later on the first request.

| Variable | Required | Notes |
| --- | :---: | --- |
| `MONGO_URI` | ✅ | MongoDB connection string |
| `JWT_SECRET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ✅ | Generate with `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | | Defaults to `7d` |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | ✅ | Image uploads |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | ✅ | OAuth sign-in and calendar sync |
| `GOOGLE_REDIRECT_URI` | | Calendar-sync callback |
| `EMAIL_USER`, `EMAIL_PASS` | ✅ | Gmail app password, used for password-reset mail |
| `BACKEND_URL`, `FRONTEND_URL` | | Used to build OAuth and reset links |
| `CORS_ORIGINS` | | Comma-separated allow-list; localhost dev ports are always allowed |
| `CRON_SECRET` | | Serverless only — shared secret for `GET /cron/calendar-sync` |
| `PORT`, `NODE_ENV` | | `NODE_ENV=production` disables Swagger |

> **Google OAuth needs *two* redirect URIs registered** in Google Cloud:
> `${BACKEND_URL}/auth/google/callback` (sign-in) and
> `${BACKEND_URL}/calendar-sync/google/callback` (calendar sync).

### Scripts

| Command | Description |
| --- | --- |
| `npm run start:dev` | Watch-mode dev server |
| `npm run build` | Compile to `dist/` with `nest build` |
| `npm run start:prod` | Run the compiled build |
| `npm test` | Unit tests (34 tests across 4 suites) |
| `npm run test:cov` | Tests with coverage |
| `npm run lint` | ESLint with `--fix` |
| `npm run format` | Prettier |

---

## API overview

All responses are wrapped by a global `TransformInterceptor` as
`{ data, timestamp, path }`; errors go through a global exception filter.
Protected routes expect `Authorization: Bearer <accessToken>`.

| Prefix | Highlights |
| --- | --- |
| `/health` | Liveness + database connectivity |
| `/auth` | `login`, `register`, `logout`, `refresh`, `google`, `google/callback`, `profile`, `complete-profile`, `change-password`, `forgot-password`, `reset-password` |
| `/users`, `/admin/users` | User CRUD; admin-only listing |
| `/training-plans` | CRUD, `:id/activate`, `:id/share`, `:id/clones`, `user/:userId/with-shared` |
| `/nutrition-plans` | CRUD, `:id/activate`, `:id/share`, `:id/ratings`, `user/:userId/with-shared` |
| `/physical-data` | CRUD plus `user/:userId/latest`, `/progress`, `/bmi` |
| `/status/:userId` | Active plan, menu, phase, workout-completed |
| `/trainer-connections` | `invite`, `clients`, `my-connections`, `:id/accept`, `:id/decline` |
| `/calendar-sync` | `google/auth-url`, `google/callback`, `google/status`, `google/disconnect`, `weekly`, `sync-training-plan` |
| `/ai-recommendations` | CRUD, filterable by user and category |
| `/upload` | Single and multiple image upload |
| `/cron/calendar-sync` | Scheduled sync trigger, guarded by `CRON_SECRET` |

Run the app locally and open `/docs` for the full, always-current reference.

### Project structure

```
src/
├── app.module.ts            # root module wiring
├── create-app.ts            # shared app factory (helmet, CORS, pipes, Swagger)
├── main.ts                  # local/server entrypoint — calls listen()
├── config/                  # env validation + database config
├── common/                  # guards, filters, interceptors, decorators, pipes,
│                            # health, cloudinary, nodemailer, google-calendar
├── objects/                 # feature modules (controller + service + schema)
│   ├── auth/  user/  training-plan/  nutrition-plan/  physical-data/
│   └── progress-stats/  current-status/  trainer-connection/
│       calendar-sync/  ai-recommendation/
├── interfaces/  utils/  middleware/
api/index.ts                 # Vercel serverless entrypoint
```

`create-app.ts` exists so the serverless and long-running entrypoints share one
configuration and cannot drift apart.

---

## Deployment (Vercel)

`vercel.json` builds with `nest build` and serves everything through
`api/index.ts`. Three constraints are easy to trip over:

1. **`api/index.ts` must import from `../dist/create-app`, not `../src/...`.**
   Vercel bundles the entrypoint with esbuild, which does not implement
   `emitDecoratorMetadata` — bundling the TS sources strips `design:paramtypes`
   and every Nest DI injection fails at runtime. `nest build` (tsc) emits it
   correctly, and `includeFiles: "dist/**"` ships the result.
2. **Every runtime import must be declared in `backend/package.json`.** The repo
   sits inside a parent folder that has its own `node_modules`, so Node's upward
   resolution hides missing dependencies locally while they fail on Vercel. If a
   build dies on a missing module, check imports against `package.json` first.
3. `vercel.json` must not contain both `builds` and `functions` — Vercel rejects
   that outright.

On long-running hosts (`render.yaml` is kept as a blueprint), the in-process
`@nestjs/schedule` cron handles calendar sync; on serverless, Vercel Cron calls
`/cron/calendar-sync` with the `CRON_SECRET` bearer token instead.

Swagger is disabled when `NODE_ENV=production`, so the schema is not publicly
browsable in the live deployment.

## Security notes

- JWT access/refresh pair, with a persisted blacklist so logout genuinely invalidates a token.
- Role-based access via a `@Roles()` decorator and `RolesGuard`.
- Request logging redacts password/token/secret fields recursively before writing.
- Auth logging is id-only — payloads and user objects are never logged.
- `forgot-password` responds identically for known and unknown emails, including
  when the mail send itself fails, so the endpoint cannot be used to enumerate accounts.
- helmet is applied globally, with a relaxed CSP scoped to the `/docs` route only.

## Known gaps

- **`ProgressStatsModule` is not imported into `AppModule`**, so the `/progress/*`
  routes are not mounted (they return 404). The service and its tests exist and pass;
  only the wiring is missing. Nothing in the frontend calls these routes today.
- `updateWorkoutCount` increments counters by hand while `regenerateProgressStats`
  derives them — two sources of truth that can disagree.
- Swagger paths are generated from the routes but lack per-endpoint
  `@ApiOperation` / response decorators.
- ESLint sits at a long-standing baseline of pre-existing warnings, mostly
  `no-unsafe-*` around Mongoose, JWT and googleapis typings.
