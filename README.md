# Conduit with private article collections

A RealWorld/Conduit implementation (React + Vite, Express, Sequelize,
PostgreSQL) extended with **private article collections**: named lists of
articles that only their owner can see or change.

Built on [TonyMckes/conduit-realworld-example-app][upstream], MIT licensed.
The original `LICENSE` is unchanged and the upstream commit history is intact
in this repository.

[upstream]: https://github.com/TonyMckes/conduit-realworld-example-app

---

## Contents

- [What was added](#what-was-added)
- [Running it](#running-it)
- [Tests](#tests)
- [API](#api)
- [Decisions](#decisions)
- [Fixes to the starter repository](#fixes-to-the-starter-repository)
- [Known limitations](#known-limitations)
- [AI usage](#ai-usage)

---

## What was added

A signed-in user can create collections, rename them, edit their description
and delete them without touching any articles. Articles are saved into a
collection from the article page, appear in the collection's detail view with
pagination, and can be removed again. The same article cannot appear twice in
one collection. No user can read or change another user's collection through
any URL, body or identifier.

New backend files live in `backend/{migrations,models,services,controllers,routes}`,
new frontend files in `frontend/src/{routes/Collections,components/SaveToCollection,
components/CollectionForm,hooks,services}`.

## Running it

### Prerequisites

- Node 22 (`.nvmrc` pins it; Vite 7 needs 20.19+ or 22.12+)
- Docker, for the local Postgres — or your own Postgres 13+ if you prefer

### Setup

```bash
git clone <this repository>
cd conduit-collections
npm ci

# Two env files: the root one is for the database container,
# the backend one is for the app.
cp .env.example .env
cp backend/.env.example backend/.env
```

Then put a real key in `backend/.env`:

```bash
# JWT_KEY - generate your own
openssl rand -hex 32
```

Start Postgres and build the schema:

```bash
docker compose up -d          # Postgres 16 on localhost:5434
npm run db:migrate            # create the schema
npm run db:seed               # optional: 5 users and 55 articles
```

The container creates both `conduit_development` and `conduit_test` on first
start. If you are using your own Postgres instead, create those two databases
and point `backend/.env` at it.

### Run

```bash
npm run dev
```

Frontend on <http://localhost:3000>, API on <http://localhost:3001>. The Vite
dev server proxies `/api` to the backend.

Seeded users are `example1@mail.com` … `example5@mail.com`. Their seeded
passwords are not hashed, so **register a new account** to sign in — see
[Known limitations](#known-limitations).

## Tests

```bash
npm run lint           # eslint
npm test               # backend + frontend
npm run test:backend   # vitest, node, against a real Postgres
npm run test:frontend  # vitest, jsdom, MSW
npm run test:e2e       # playwright, against the built frontend
```

The backend suite needs the database container running. It rolls the test
database all the way back and migrates it up again before the first test, so
a migration that is not reversible, or not reproducible from an empty
database, fails the suite immediately.

Tests do not depend on each other or on execution order: each one starts from
`TRUNCATE ... RESTART IDENTITY CASCADE`, and the factories mint unique names.
Verified with `npx vitest run --sequence.shuffle`.

The E2E suite builds the frontend and runs against the build, not the dev
server. It needs the development database and a browser
(`npx playwright install chromium`).

There is also a one-off check that the baseline migration reproduces what the
old boot-time `sync()` was building:

```bash
./scripts/verify-baseline-schema.sh   # builds a database each way, diffs pg_dump
```

### What the tests protect

| Area | Examples |
| --- | --- |
| Authentication | every collections route 401s with no token, a malformed token and an empty `Authorization` header — driven off the router's own route table, so a new route cannot be missed |
| Ownership | user B gets 404 on read, update, delete, add and remove against A's collection, and A's rows are asserted unchanged afterwards |
| Mass assignment | a `userId` or `id` in the request body is ignored on create and update |
| Duplicates | two concurrent adds give exactly one 201 and one 409; a direct SQL insert is rejected |
| Constraints | a blank name is rejected by the database, not only by the service |
| Deletion | deleting a collection leaves its articles; deleting an article removes its memberships |
| Query cost | a page costs the same number of queries with 1 article or 20 |
| Leakage | no response carries `userId`, `email`, `password`, `token` or the article `body` |
| Frontend | loading, empty and error states; a 409 shown inline; a double-clicked submit sending one request; the picker's optimistic toggle and its rollback; stepping back a page after removing the last article on it |

## API

All collection routes require a token and act only on the caller's own data.
Errors keep the existing `{ errors: { body: [...] } }` shape.

| Method | Path | Behaviour |
| --- | --- | --- |
| `GET` | `/api/collections` | Your collections with `articlesCount`. `?article=<slug>` adds `hasArticle` for the save picker |
| `POST` | `/api/collections` | `{ collection: { name, description } }` → 201 |
| `GET` | `/api/collections/:id` | 404 if it does not exist **or is not yours** |
| `PUT` | `/api/collections/:id` | Partial update; only `name` and `description` are writable |
| `DELETE` | `/api/collections/:id` | 204; articles are untouched |
| `GET` | `/api/collections/:id/articles` | `{ articles, articlesCount }`, same shape as `/api/articles` without `body`. `limit` (max 50) and `offset` count **rows** |
| `POST` | `/api/collections/:id/articles` | `{ article: { slug } }` → 201, or 409 if already there |
| `DELETE` | `/api/collections/:id/articles/:slug` | 204, or 404 if not in the collection |

Status codes: 401 no or bad token · 404 unknown or not yours · 409 duplicate ·
422 invalid input.

> **`offset` counts rows here, pages on `/api/articles`.** The existing
> endpoints compute `offset * limit` and the current frontend depends on it,
> so they were left alone rather than changed underneath working screens. A
> characterization test pins that behaviour so the difference stays deliberate.

## Decisions

**UUID ids for collections.** A collection id cannot be enumerated and does
not reveal how many exist. Access control is still the owner in the `WHERE`
clause — the id being hard to guess is not the control.

**404, not 403, for another user's collection.** A 403 confirms the id exists,
which is a yes/no oracle over private data. Articles are public, so they keep
403. The asymmetry is deliberate.

**The owner is in every query, never checked afterwards.** Every read and
write is `where: { id, userId: req.loggedUser.id }`. Nothing loads a row and
compares owners after the fact, so there is no window between the read and the
check, and the owner id always comes from the verified token.

**Auth on the router, not on each route.** `verifyToken` and `requireAuth` are
attached with `router.use(...)`, so a route added later inherits them. A test
reads the route table out of the router and asserts each one 401s, so this
cannot quietly rot.

**Duplicates are the database's job.** Membership is written with
`CollectionArticle.create()` so the composite primary key rejects a duplicate
and the controller turns that into a 409. Sequelize's generated
`collection.addArticle()` does a `SELECT` first and silently skips a row that
already exists — which reports success for a duplicate and still races a
concurrent request. Two concurrent adds are tested.

**Unique collection names per user, case-insensitively.** Two collections
called "Reading list" in the save picker would be a coin toss. Enforced with a
unique index on `(userId, lower(name))`.

**Memberships point at `articleId`, not the slug.** Renaming an article
changes its slug; saved articles survive it. Deleting an article removes it
from every collection through `ON DELETE CASCADE`, so no read has to filter
out articles that no longer exist.

**A fixed number of queries per page.** One query for the page with its
authors, then one each for tags, favourites and follows across the whole page
with `IN (...)`. Measured at 7 queries whether the page holds 1 article or 20;
the existing `/api/articles` loop takes 123 for 20 articles. A test asserts
the count does not vary with page size.

**Pessimistic writes for create, rename and delete; optimistic for the picker
toggles.** The server owns the collection id and can reject a name, and a row
that appears and then vanishes reads as a bug — so those wait, with submit
disabled while in flight (which also makes a double click send one request).
A checkmark in the picker needs to move under the cursor, so those are
optimistic and roll back on failure. A 409 on add and a 404 on remove are
treated as already done, so a double click or a second browser tab ends in the
same state rather than showing an error for something that worked.

**Responses are built by hand, not serialised from the model,** so a column
added later cannot start appearing in API responses on its own.

**UI built from what was already there.** `ContainerRow`, `BannerContainer`,
`FormFieldset`, `.article-preview` rows, the existing button classes and the
Ionicons the app already loads. No new fonts, colours or radii — the new CSS
contains no hex values, only the existing custom properties. `ArticlesPreview`
gained one optional `onRemove` prop and renders exactly as before without it.
The only genuinely new component is the save picker, and its styles are scoped
under `.collection-picker` rather than defining `.dropdown-menu` globally,
which would have restyled the navbar user menu.

## Fixes to the starter repository

Each of these blocked the work; each was fixed with the smallest change that
got past it.

| Problem | Fix |
| --- | --- |
| Migrations were incomplete — `Articles.userId`, `Comments.articleId`/`userId` and the `Favorites`, `Followers` and `TagList` tables were missing. The app only worked because `index.js` ran `sequelize.sync({ alter: true })` on every boot, and the article seeder inserts a column no migration creates | Added a migration creating exactly what `sync()` was building, verified by diffing `pg_dump --schema-only` between a sync-built and a migration-built database (`scripts/verify-baseline-schema.sh`) |
| Boot-time `sync({ alter: true })` silently rewrote the schema, which is what let the gap go unnoticed | Removed; boot now only authenticates. Migrations own the schema |
| `npm test` failed on a clean checkout — `vitest.config.js` asked for the jsdom environment and jsdom was not installed | Installed jsdom and split into two vitest projects: backend in node, frontend in jsdom |
| The backend could not be imported for tests: `index.js` built the app and called `listen()` together | Split `app.js` (exports the app) from `index.js` (starts it) |
| `backend/.env.example` described MySQL while only the `pg` driver is installed, and its logging keys were misspelled (`DEV_DB_LOGGGIN`). Fixing only the spelling would have made every query throw, because Sequelize calls `logging` as a function and would have been handed a string | Rewrote the example for Postgres; `config.js` maps the flag to `console.log` or `false` |
| A malformed `Authorization` header came back as 500 (`verifyToken` threw a `SyntaxError` with no branch in the error handler) | Mapped to 401, along with the jsonwebtoken errors |
| `verifyToken` called `next()` twice for a token belonging to a deleted user — a missing `return` | Added the `return` |
| The error handler logged the whole error object. A Sequelize error carries the failing SQL and its bound parameters, which is how password hashes reach logs | Logs name, message and stack; 500 responses no longer echo the internal message to the client |
| The frontend `errorHandler` only rethrew for 401/403/404/422/500. A 409 or a dropped connection was logged, the service resolved `undefined`, and the UI behaved as if the request had worked | It now always throws |
| `Article.jsx` skipped its fetch whenever router state existed. List endpoints do not send the article body, so an article opened from a collection rendered an empty page | Fetches when `state.body` is missing |
| No linter and no CI | Added a small ESLint flat config and one GitHub Actions workflow |
| A Windows checkout rewrote `scripts/init-test-db.sh` to CRLF, which `/bin/sh` cannot run | Added `.gitattributes` normalising to LF |
| `npm run dev` failed on Windows. The script quoted its sub-commands with single quotes, which `cmd.exe` does not treat as quoting, so `'npm run dev -w backend'` was parsed as five separate tokens | Switched to double quotes, which quote correctly in both `cmd.exe` and POSIX shells |

## Known limitations

- **The seeded users cannot log in.** `seeders/20220427123216-create-users.js`
  inserts plaintext passwords, and login compares against a bcrypt hash. This
  predates this work and fixing it would change the seed data the upstream
  project ships. Register a new account instead.
- **`styles.css` asks for the Lora font but `index.html` never loads it,** so
  the serif headings fall back. Pre-existing; left alone as an unrelated
  visual change.
- **The existing article endpoints are still N+1** (about six queries per
  article). Fixing them would change behaviour on screens this feature does
  not touch. The batched approach used by the collection endpoints is the
  template for doing it later.
- **`DELETE /api/articles/:slug/comments/:commentId` ignores the slug.** You
  can delete your own comment through any article's URL. Ownership is still
  enforced, so it is untidy rather than a hole. Pre-existing; not in scope.
- **`Articles.userId` and `Comments.userId` are `ON DELETE SET NULL`,** not
  the `CASCADE` the models ask for — Sequelize emits `SET NULL` for a nullable
  foreign key, and the baseline migration reproduces what the running schema
  actually had. Changing it is a behaviour change, not a migration fix.
- **Pagination is `OFFSET`-based** and `articlesCount` is computed per
  request. Fine at this size, and the reasoning plus what would replace it is
  in [DESIGN_NOTE.md](DESIGN_NOTE.md).
- **No rate limiting** on collection writes.
- **Collections are not searchable or sortable**, and articles cannot be saved
  directly from a feed preview — only from an article page. Both are listed as
  next steps in the design note.

## AI usage

Claude (Claude Code) was used throughout, for:

- reading the starter repository and writing up what was wrong with it
- drafting the migrations, service, controller, routes, components and tests
- drafting this README and `DESIGN_NOTE.md`

Everything was reviewed and run before being committed. The schema diff,
the query-count measurement and the API walkthrough in this README are all
outputs from actually executing the code, not claims.

**An AI suggestion that was corrected.** The first draft of the frontend
`errorHandler` threw a rich `Error` object carrying `error.status`, so the
save picker could check for a 409. That would have broken three existing
screens: `AuthPageContainer`, `ArticleEditorForm` and `Login` render the
thrown value straight into JSX (`<li>{error}</li>`), and React refuses to
render an `Error`. Caught by reading those call sites rather than by a test —
the existing tests only asserted *that* it threw, not what. The handler now
throws a plain string, and the one place that needs the status code
(`toggleCollectionArticle`) reads `error.response.status` itself before
delegating. That is also the better boundary: what a 409 *means* is specific
to that endpoint, not something the shared handler should know.

A second, smaller one: the initial collection detail page rendered each
article title twice — once through `ArticlesPreview` and again in a separate
list that carried the Remove buttons. Replaced by adding one optional
`onRemove` prop to `ArticlesPreview`, which is genuine reuse rather than a
parallel list to keep in sync.
