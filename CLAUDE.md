# CLAUDE.md

Guidance for Claude Code (and any other agent or engineer) working in this
repository.

> **Keep this file current.** It describes how this repo actually behaves, not
> how it ideally would. If you change a command, a convention, or one of the
> traps below, update the relevant line in the same commit. A stale line here
> is worse than no line, because the next person will trust it. There is a
> checklist at the bottom.

---

## What this is

A fork of [TonyMckes/conduit-realworld-example-app][upstream] (RealWorld /
Conduit: React + Vite, Express, Sequelize, PostgreSQL) extended with a
**private article collections** feature. Built as a technical assessment.

[upstream]: https://github.com/TonyMckes/conduit-realworld-example-app

The governing constraint, and the reason several things below look
conservative: **extend the existing app, do not rewrite it.** Large
refactors, framework changes and unrelated redesigns are out of scope and
count against the work. When in doubt, match what is already there.

## Layout

```
backend/           Express + Sequelize (CommonJS)
  app.js           builds and exports the app — import this in tests
  index.js         starts it; the only place that calls listen()
  config/          Sequelize config, reads env
  controllers/     HTTP in, status codes out. Thin.
  services/        queries and rules. collections.js is the interesting one.
  models/          Sequelize models
  migrations/      schema, in order. The schema's only source of truth.
  middleware/      verifyToken, requireAuth, errorHandler
  helper/          jwt, bcrypt, slugify, custom error classes
  tests/           vitest + supertest against a real Postgres
frontend/src/      React 19 + Vite (ES modules)
  routes/          page components
  components/      folder-per-component, each with an index.js
  hooks/           useArticles, useCollections, useCollectionArticles
  services/        one file per API call, axios + errorHandler
  tests/           MSW server and render helpers
e2e/               Playwright, runs against the built frontend
scripts/           dev and verification shell scripts
```

## Commands

```bash
npm ci                  # install (workspaces: backend, frontend)
docker compose up -d    # Postgres 16 on :5434, creates dev + test databases
npm run db:migrate      # build the schema
npm run db:seed         # 5 users, 55 articles (see the seeder trap below)
npm run dev             # backend :3001 + frontend :3000

npm run lint            # eslint, must exit 0
npm test                # both vitest projects
npm run test:backend    # node env, needs the database running
npm run test:frontend   # jsdom env, MSW
npm run test:e2e        # playwright; builds the frontend first

./scripts/verify-baseline-schema.sh   # migration output == old sync() output
```

Env: `cp .env.example .env` (compose) **and** `cp backend/.env.example
backend/.env` (app). Generate `JWT_KEY` with `openssl rand -hex 32`. Neither
`.env` is committed.

## Conventions

Match these. They come from the existing codebase, not from preference.

- **Backend is CommonJS** (`require`/`module.exports`), **frontend is ESM**.
  Do not convert either.
- **Double quotes, semicolons, trailing commas.** Two-space indent.
- **Route comment markers** the existing route files use: `//*` for a write,
  `//?` for a read or an explanatory note, `//>` for a mounted sub-router.
- **Comments explain why, not what.** If a comment restates the code, delete
  it. The ones worth keeping record a decision or a trap.
- **Components** live in `components/Name/Name.jsx` with an
  `index.js` containing `export { default } from "./Name";`.
- **Services** are one file per API call, default-exported, taking `headers`
  from `useAuth()`, wrapping the call in `try`/`catch` and delegating to
  `errorHandler`.
- **Controllers** are `try { ... } catch (error) { next(error) }`. No status
  codes outside controllers; no queries inside them.
- **Commits** are short, specific and conventional-ish
  (`feat(api):`, `fix(db):`, `test(web):`). Explain *why* in the body.

## Traps

Things that have already cost time here. Read before debugging.

**The schema is owned by migrations, not `sync()`.** Boot used to call
`sequelize.sync({ alter: true })`, which silently papered over four
migrations' worth of missing columns and tables. That call is gone. If you
add a model field, **add a migration** — nothing will fix it for you at
runtime, and CI migrates up, all the way down, and up again to prove it.

**Two `.env` files, and vitest runs from the repo root.** The root `.env` is
for docker compose (4 variables); `backend/.env` is for the app (23). Plain
`dotenv.config()` resolves against the *cwd*, so anything the backend tests
load must point at `backend/.env` explicitly — see
`backend/tests/setupTests.js`. A backend test failing with "Dialect needs to
be explicitly supplied" means the wrong `.env` won.

**`helper/jwt.js` reads `JWT_KEY` at require time.** Anything that requires it
before dotenv has run gets `undefined` and every token fails. Load order in
`backend/tests/setupTests.js` is deliberate: `NODE_ENV`, then dotenv, then
models.

**Do not `require("vitest")` in backend tests.** The backend is CommonJS and
vitest cannot be required from CJS. `globals: true` is set — use the bare
`describe`/`test`/`expect`/`vi`.

**`offset` means different things on different endpoints.** `/api/articles`
computes `offset * limit` (pages); the collection endpoints count rows. This
is pinned by a characterization test on purpose. Do not "fix" the old
behaviour — the current frontend depends on it.

**The seeded users cannot log in.** The seeder inserts plaintext passwords and
login compares a bcrypt hash. Register a new account when testing by hand.

**The app uses `HashRouter`.** Every URL is `/#/path`. Playwright navigation
must include the `#`.

**`index.css` has `button:focus { outline: 0 !important }`.** Any new
interactive element needs its focus ring drawn with `box-shadow`, or keyboard
users get nothing.

**`ArticlesButtons` renders twice on an article page** (banner and footer). Any
state it holds exists in two copies. The save picker loads its data when it
opens for exactly this reason.

**Line endings.** `.gitattributes` forces LF. The shell scripts are mounted
into a Linux container and run in CI; CRLF breaks them.

## Rules that must not be weakened

These are the parts a reviewer will probe. Changing any of them needs a
deliberate decision, not a convenience.

1. **Auth is attached at the router level** in `routes/collections.js`
   (`router.use(verifyToken, requireAuth)`), never per route. A test walks
   the router's own stack and asserts every route 401s — it will catch a new
   route automatically. Do not move auth onto individual routes.
2. **The owner goes in the `WHERE` clause.** Every collection query is scoped
   with `userId: req.loggedUser.id`. Never load a row and compare owners
   afterwards. Never take an owner id from params, query or body.
3. **Another user's collection is a 404, not a 403.** A 403 confirms it
   exists.
4. **Only `name` and `description` are writable.** `readWritableFields()` in
   `services/collections.js` is the whitelist. Do not spread `req.body`.
5. **Duplicates are rejected by the database.** Insert memberships with
   `CollectionArticle.create()` and map `UniqueConstraintError` to 409. Never
   use the generated `collection.addArticle()` — it `SELECT`s first, silently
   skips an existing row and races.
6. **Reads take a constant number of queries.** Load a page, then batch each
   extra kind of data with one `IN (...)` query. Never query inside a loop
   over articles. A test asserts the count does not vary with page size.
7. **Never serialize `req.loggedUser`** — its `dataValues` carries the raw
   token. Responses are built by hand, not spread from a model.
8. **Never interpolate user input into `sequelize.literal` or a raw query.**
   Use `replacements`.
9. **Do not log error objects.** A Sequelize error carries the failing SQL and
   its bound parameters. Log name, message and stack.

## Testing

- Backend tests run **serially** (`fileParallelism: false`) against one real
  Postgres. Each test starts from `TRUNCATE ... RESTART IDENTITY CASCADE`.
- Use the factories in `backend/tests/factories.js`; they mint unique names so
  no test depends on another or on order. Verify with
  `npx vitest run --sequence.shuffle`.
- Frontend tests use MSW with `onUnhandledRequest: "error"`, so a component
  that starts calling something new fails loudly instead of hanging.
- `react-paginate` renders page links as `role="button"` with
  `aria-label="Page N"`, not as links.
- Supply auth in component tests with `AuthContext.Provider` via
  `renderWithProviders` — `AuthProvider` reads `localStorage` at module load
  and a test cannot get in front of it.
- **When you add a route, add the boundary tests with it**: unauthenticated,
  wrong owner, invalid input.

## Styling

The visual system is Conduit's own, extended. Not a redesign.

- Use the custom properties already in `frontend/src/styles.css`.
  **New CSS should contain no hex values.**
- Do not set `font-family`; inherit Source Sans Pro from `body`.
- Build from `ContainerRow`, `BannerContainer`, `FormFieldset`,
  `.article-preview` rows, `btn btn-sm` variants and `.error-messages`.
- Icons: **Ionicons 2.0.1 only** — that is what `index.html` loads. Check the
  icon exists in 2.0.1, not just in a later version.
- New component styles go in `frontend/src/collections.css`, scoped under a
  component class. Never define `.dropdown-menu` globally; the navbar uses it.
- Copy is short and plain, sentence case, matching "Loading tags…" and "There
  are no comments yet…". No "Oops!", no exclamation marks, no emoji.
- Avoid: gradients, cards with soft shadows in a grid, skeleton shimmers,
  toasts, modals for simple confirmations, fade-in entrances, all-caps
  labels, arrows appended to button labels, a second icon set, new fonts.

## Before you call something done

```bash
npm run lint && npm test && npm run test:e2e
```

Then check:

- [ ] Schema changes have a migration, and `db:migrate:undo:all` followed by
      `db:migrate` still works.
- [ ] New routes have unauthenticated, wrong-owner and invalid-input tests.
- [ ] No secret, token, password or raw error object reaches a log.
- [ ] No new hex colour, font or icon set.
- [ ] Existing screens still behave — the characterization tests in
      `backend/tests/characterization.test.js` are the guard; if you had to
      change one, say why in the commit.
- [ ] **This file, [CODEBASE.md](CODEBASE.md) and [README.md](README.md)
      updated if anything above changed.**
