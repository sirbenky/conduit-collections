# Codebase guide

A working explanation of how the collections feature fits into this
application: what runs where, why it is built this way, what it costs, and
how to change it safely.

Written for a senior engineer who has not worked on this code and needs to
review it, debug it, or continue it.

> **Keep this current.** Every claim here is meant to be checkable against the
> code as it stands. Deliberately **no line numbers** — they rot. References
> are file plus function name, which survive edits. When behaviour changes,
> change the matching section in the same commit, and re-run the measurements
> in [Evidence](#evidence) rather than copying the old numbers forward.

---

## Contents

1. [Sixty-second orientation](#1-sixty-second-orientation)
2. [Walkthrough: one request, end to end](#2-walkthrough-one-request-end-to-end)
3. [The data model](#3-the-data-model)
4. [The security model](#4-the-security-model)
5. [Query cost, and why it stays flat](#5-query-cost-and-why-it-stays-flat)
6. [Frontend state](#6-frontend-state)
7. [Trade-offs](#7-trade-offs)
8. [Debugging playbook](#8-debugging-playbook)
9. [Making a small change](#9-making-a-small-change)
10. [Evidence](#10-evidence)
11. [Where the bodies are buried](#11-where-the-bodies-are-buried)

---

## 1. Sixty-second orientation

The application is a Conduit/RealWorld blog: users, articles, comments,
tags, favourites, follows. This work adds **private collections** — named
lists of articles that only the owner can see or modify.

The layering, back to front:

```
routes/collections.js        auth on the router, path → controller
  controllers/collections.js HTTP: read the request, choose a status code
    services/collections.js  the queries, the rules, the validation
      models/                Sequelize
        migrations/          the schema, which is the real contract
```

Frontend, front to back:

```
routes/Collections/          pages: list and detail
components/SaveToCollection/ the picker, reached from any article page
  hooks/useCollections.js    data + loading + error + reload
    services/*.js            one file per API call
      helpers/errorHandler   turns an axios failure into a thrown string
```

**The three sentences that explain most of the design:**

1. Every collection query carries the owner's id in its `WHERE` clause, and
   that id always comes from a verified token — never from the request.
2. The two invariants that matter (no duplicate article in a collection, no
   two collections with the same name per user) are enforced by database
   constraints, not by application checks, because application checks lose
   races.
3. Reading a page of a collection costs a fixed number of queries no matter
   how many articles are on it.

## 2. Walkthrough: one request, end to end

Take `POST /api/collections/:id/articles` — saving an article. It touches
every layer and every rule.

### The request arrives

`backend/app.js` mounts `/api/collections` on the collections router. Note
that `app.js` only *builds* the app; `index.js` calls `listen()`. That split
exists so Supertest can `require("../app")` without binding a port — the
original code did both in one file, which is why the project had no API
tests.

### Authentication, once, for the whole router

`backend/routes/collections.js`:

```js
router.use(verifyToken, requireAuth);
```

This is on the **router**, not on each route. `verifyToken` (in
`middleware/authentication.js`) identifies the caller if a token is present
and leaves `req.loggedUser` undefined if not — public routes elsewhere depend
on that. `requireAuth` then rejects anyone still anonymous.

Router-level attachment is a deliberate choice: a route added below inherits
the check instead of relying on whoever adds it. `tests/collections.auth.test.js`
reads the route table out of the router object itself and asserts every entry
401s, so a new route is covered the moment it exists.

Two bugs were fixed in `verifyToken` along the way: a malformed header threw
a `SyntaxError` that the error handler had no branch for (a 500 for what is
plainly a client error), and a token for a deleted user called `next()` twice
because of a missing `return`, so Express ran both the error handler and the
route handler.

### The controller

`controllers/collections.js` → `addArticle`:

```js
const collection = await collections.addArticle({
  userId: req.loggedUser.id,        // from the verified token
  id: req.params.id,
  slug: req.body?.article?.slug,
});
res.status(201).json({ collection });
```

The controller does three things: pull values out of the request, call the
service, pick a status code. **`userId` comes from `req.loggedUser`** — set
by `verifyToken` from a signature-verified token. No controller in this
feature reads an owner id from params, query or body, so there is nothing for
a client to substitute. Two tests plant a `userId` in the body on create and
on update and assert it is ignored.

### The service

`services/collections.js` → `addArticle` does the real work:

**1. Find the collection, scoped to the owner.** Via `findOwnedCollection`:

```js
if (!isUuid(id)) throw new NotFoundError("Collection");
const collection = await Collection.findOne({ where: { id, userId } });
if (!collection) throw new NotFoundError("Collection");
```

Three things are happening:

- The UUID is validated *before* it reaches Postgres. A malformed UUID makes
  Postgres raise a type error, which would surface as a 500 and hand the
  caller a database message.
- `userId` is in the `WHERE` clause. The query **cannot** return another
  user's row, so there is no ownership comparison to get wrong and no window
  between a read and a check.
- A collection that exists but is not yours produces exactly the same
  `NotFoundError` as one that does not exist. A 403 would confirm the id is
  real, which over private data is an enumeration oracle.

**2. Resolve the slug to an article id.** Memberships point at `articleId`,
not the slug, so renaming an article does not lose it from collections.

**3. Insert, and let the database reject a duplicate:**

```js
await rejectDuplicate(
  () => CollectionArticle.create({ collectionId, articleId }),
  "That article is already in this collection.",
);
```

This is the part worth dwelling on. Sequelize generates
`collection.addArticle()` for a `belongsToMany`, and it is the obvious thing
to reach for — but it issues a `SELECT` first and **silently skips** a row
that already exists. That means a duplicate save returns success, and two
concurrent saves can both pass the `SELECT` before either `INSERT`s.

Writing through the join model instead means the composite primary key
`(collectionId, articleId)` decides. `rejectDuplicate` catches Sequelize's
`UniqueConstraintError` and rethrows a `ConflictError`, which the error
handler maps to 409. `tests/collections.membership.test.js` fires two adds
with `Promise.all` and asserts exactly one 201, one 409, one row — and
separately asserts a raw `INSERT` is rejected, proving the rule is in the
database rather than in the service.

### The error handler

`middleware/errorHandler.js` maps an error class to a status:
`UnauthorizedError` and the jsonwebtoken errors to 401, `ForbiddenError` 403,
`NotFoundError` 404, `ConflictError` and `SequelizeUniqueConstraintError` 409,
`ValidationError` 422, everything else 500.

It logs the error's **name, message and stack** — not the object. A Sequelize
error carries the failing SQL and its bound parameters in enumerable fields,
which is how password hashes and tokens end up in log aggregators. 500
responses return a generic message rather than echoing the internal one.

### Back on the client

`services/toggleCollectionArticle.js` made the call. It inspects the status
before delegating to the shared handler:

```js
if (!saved && status === 409) return { saved: true, alreadyDone: true };
if (saved && status === 404) return { saved: false, alreadyDone: true };
```

A 409 on add means the article is already there; a 404 on remove means it is
already gone. Either way the server is in the state the user asked for, so
these are successes, not errors — which is what makes a double click, or the
same article saved in a second tab, converge instead of showing an error for
something that worked.

That semantic judgement lives in the service that knows the endpoint, not in
the shared `errorHandler`, which has no business knowing what a 409 means
here.

## 3. The data model

```
Users ──< Collections ──< CollectionArticles >── Articles
```

**`Collections`** — `id` UUID PK, `userId` (FK, `ON DELETE CASCADE`), `name`
varchar(60) NOT NULL, `description` varchar(280) NULL, timestamps.

- `CHECK (btrim(name) <> '')` — `NOT NULL` alone still allows `"   "`.
- `UNIQUE (userId, lower(name))` — a functional index, because Sequelize
  cannot express `lower(name)`. Two collections called "Reading list" in the
  save picker would be a coin toss for the user.
- `ON DELETE CASCADE` on the owner: a deleted user's private lists have no
  other owner.

**`CollectionArticles`** — `collectionId`, `articleId`, `createdAt`.

- PK `(collectionId, articleId)` — this is the duplicate prevention.
- No `updatedAt`: a membership is created and removed, never edited.
- Index `(collectionId, createdAt DESC)` — the detail page reads newest-first
  and comes straight off this index in display order.
- Index `(articleId)` — the composite PK starts with `collectionId` and cannot
  serve the reverse lookup. Without this, deleting a popular article scans the
  whole membership table to cascade.

**Why UUIDs for collections but integers for articles.** Article ids are
already integers and already public through slugs. Collection ids appear in
URLs for private data, where a sequential id is enumerable and leaks total
volume. This is defence in depth — the actual control is the owner in the
`WHERE` clause — but it is free, and it makes an id you were not given useless
even to guess at.

### The baseline migration

`migrations/20260921100000-baseline-add-missing-associations.js` is not part
of the feature; it is the repair that made the feature possible.

The four original migrations create `Users`, `Articles`, `Comments` and `Tags`
but **none** of the association columns or join tables — no `Articles.userId`,
no `Comments.articleId`, no `Favorites`, `Followers` or `TagList`. The app
worked anyway because `index.js` ran `sequelize.sync({ alter: true })` on
every boot and quietly added them. A database built from the committed
migrations alone could not run the app: the article seeder inserts a `userId`
column that no migration creates.

The fix adds exactly what `sync()` was building — including the `ON DELETE`
rules `sync()` actually emitted, which are not the ones the models ask for
(Sequelize falls back to `SET NULL` for a nullable FK, so `Articles.userId`
and `Comments.userId` are `SET NULL` despite the models saying `CASCADE`).
Reproducing the real schema was the goal; changing it would be a behaviour
change wearing a migration's clothes.

`scripts/verify-baseline-schema.sh` proves it: it builds one database with
`sync()` and one with the migrations and diffs `pg_dump --schema-only`. The
diff is empty. Boot no longer calls `sync()` at all, and CI migrates up, all
the way down, and up again so an irreversible migration fails the build.

## 4. The security model

The brief asks specifically about horizontal privilege escalation. Here is
each boundary and what enforces it.

| Boundary | Enforced by | Proven by |
| --- | --- | --- |
| Anonymous cannot reach any collection route | `router.use(verifyToken, requireAuth)` | every route × three bad-auth cases, driven off the router's route table |
| A bad or expired token is 401, not 500 | `UnauthorizedError` + JWT error names in `errorHandler` | malformed-token cases in the same test |
| B cannot read A's collection | `where: { id, userId }` in `findOwnedCollection` | `collections.ownership.test.js` |
| B cannot write A's collection | same clause; `destroy` and `update` also carry it | ownership tests assert A's rows are unchanged after each attempt |
| B cannot tell A's collection exists | `NotFoundError`, never `ForbiddenError` | ownership tests assert 404 |
| A client cannot set the owner | `userId` only ever from `req.loggedUser`; `readWritableFields` whitelists `name` and `description` | body-planting tests on create and update |
| A client cannot pick the id | `id` is not in the whitelist; the DB default generates it | create test asserts the planted id was not used |
| No SQL injection | ORM everywhere; the three raw queries use `replacements`; no user value is ever interpolated into `sequelize.literal` | review — the raw queries are all in `loadArticlePage` |
| No field leakage | responses are constructed by hand, not spread from models; `Collection.toJSON` drops `userId` | a test greps every collection response for `userId`, `email`, `password`, `token`, `body` |
| Secrets stay out of logs | `errorHandler` logs name/message/stack, never the error object | review |

**The pattern to preserve.** The reason this is defensible is not that each
handler remembers to check — it is that *there is no unscoped query to
forget to scope*. If you write

```js
const collection = await Collection.findByPk(id);
if (collection.userId !== req.loggedUser.id) throw new ForbiddenError();
```

you have reintroduced both problems: a read that can return someone else's
row, and a 403 that confirms existence. Keep the owner in the `WHERE` clause.

## 5. Query cost, and why it stays flat

The existing `/api/articles` handler loops over each article and, per
article, fetches tags, the author, follow state, follower count, favourite
state and favourite count — about six queries each.

Measured on this machine:

| Endpoint | 1 article | 20 articles |
| --- | --- | --- |
| `GET /api/articles` (existing) | 9 | **123** |
| `GET /api/collections/:id/articles` | 7 | **7** |

`loadArticlePage` in `services/collections.js` gets there like this:

1. One query for the page of memberships, joined to their articles and
   authors, ordered and limited.
2. Bail out if the page is empty — an `IN ()` with no values is a mistake
   waiting to happen.
3. Collect `articleIds` and the distinct `authorIds`.
4. Three queries in parallel, each covering the whole page:
   - tags: `WHERE "articleId" IN (:articleIds)`
   - favourites: `COUNT(*)` and `BOOL_OR("userId" = :loggedUserId)`, grouped
     by article
   - follows: the same shape over `Followers`, grouped by author
5. Index the results into `Map`s and assemble the response by hand.

`BOOL_OR(...)` is doing real work: it collapses "how many favourites" and
"did *I* favourite it" into one aggregate rather than one query for the count
and another for the membership.

`Favorites`, `Followers` and `TagList` have no Sequelize models — they are
string-through join tables — so those three are raw SQL. Every value is bound
through `replacements`; nothing is interpolated.

The ordering is `(createdAt DESC, articleId DESC)`. The tiebreaker is not
decoration: without it, two articles saved in the same millisecond can swap
places between page one and page two, so one is shown twice and one never.

A test spies on `sequelize.query` and asserts the count for a 1-article page
equals the count for a 20-article page. That is the guard against someone
adding a convenient `await article.getTagList()` inside the map.

## 6. Frontend state

### Hooks

`useCollections` and `useCollectionArticles` follow the shape of the existing
`useArticles`, with two additions:

**An `error` state.** `useArticles` does `.catch(console.error)`, so a failed
load renders as an empty list — "you have no collections" and "we could not
load your collections" look identical to the user. Both new hooks distinguish
them, and there are tests for each state.

**A staleness guard.** Each effect sets `let current = true` and flips it in
its cleanup, so only the latest effect can write to state. Without it, a slow
response for page 2 arriving after page 3 puts page 2's rows on screen while
the pager still reads 3.

`useCollectionArticles` also owns `goToPageAfterRemoval`, which clamps the
page index after a removal. Remove the only article on the last page and the
pager would otherwise point at a page that no longer exists — an empty list
under a pager claiming there is more. Tested with 11 articles across two
pages.

### Optimistic vs pessimistic, deliberately

**Pessimistic** — create, rename, delete (`Collections.jsx`, `CollectionForm`).
The server owns the id and can reject the name; a row that appears and then
vanishes reads as a bug. Submit is disabled while the request is in flight,
which as a side effect makes a double-clicked submit send one request — there
is a test that counts the POSTs.

**Optimistic** — the picker's toggles (`CollectionPicker.jsx`). A checkmark
has to move under the cursor. The previous value is captured before the call
so a failure restores both the tick and the count, and the final state comes
from what the service reports rather than from the guess — a 409 means it was
already saved, which is not what we optimistically assumed but is the right
answer.

### The two component changes worth knowing about

**`ArticlesPreview` gained one optional `onRemove` prop.** With it, each row
renders a Remove button next to the favourite button; without it, the
component renders exactly as before, so the home, profile and favourites
feeds are untouched. The first draft of the detail page rendered a *second*
list of titles beside the previews just to hold the Remove buttons — two
lists to keep in sync, and every title on screen twice.

**`Article.jsx`'s fetch guard changed from `if (state) return` to
`if (state?.body) return`.** `ArticlesPreview` passes the whole article as
router state when a row is clicked, and list endpoints do not include the
body — the collection endpoint omits it deliberately, since it is the largest
column and a list never shows it. With the old guard, an article opened from
a collection rendered a page with a title and no content, and never fetched.
Three tests cover it: state without a body fetches, state with a body does
not, no state fetches.

### The picker is the only new visual component

Everything else is assembled from `ContainerRow`, `BannerContainer`,
`FormFieldset`, `.article-preview` rows and the existing button classes. The
picker had no pattern to copy, so:

- Its styles are scoped under `.collection-picker` in `collections.css`.
  Defining `.dropdown-menu` globally would have restyled the navbar user menu,
  which has no styles of its own.
- It reuses the radius and shadow `.card` already uses. No new visual values.
- Escape and outside-click close it and return focus to the trigger.
- Its focus ring is a `box-shadow`, because `index.css` has
  `button:focus { outline: 0 !important }`.
- It mounts its content only while open, which is what makes it re-read
  membership each time. `ArticlesButtons` renders twice per article page
  (banner and footer), so cached state in one copy would go stale the moment
  the other was used. There is a test asserting it refetches on reopen.

## 7. Trade-offs

Each of these is a real decision with a real alternative. This is the section
to read before being asked "why did you…".

### `OFFSET` pagination instead of keyset

**Chose:** `LIMIT`/`OFFSET`, offset in rows, capped at 50.
**Rejected:** keyset on `(createdAt, articleId)`.
**Why:** keyset changes the client contract — the client sends a cursor, not a
page number — so the pager component, the URL shape and their tests all
change. At current scale `OFFSET` is free.
**Cost:** page *n* makes Postgres walk and discard *n* rows, and a removal
during paging shifts rows so one can be skipped.
**When to revisit:** deep pages appearing in the latency histogram, or the
first bug report about a missing article while paging. The ordering is
already unique, so it is a drop-in.

### Computed `articlesCount` instead of a stored counter

**Chose:** a `COUNT(*)` subquery per collection.
**Rejected:** a counter column on `Collections`.
**Why:** a counter has to survive `ON DELETE CASCADE` when an article is
deleted, which bypasses application code entirely — so it needs a row-level
trigger, a backfill, and a reconciliation job. A counter that silently drifts
is worse than a count.
**When to revisit:** when the list endpoint shows up in slow queries. Trigger
first, application-level maintenance second.

### 404 instead of 403 for another user's collection

**Chose:** 404.
**Cost:** slightly confusing for a legitimate user who lost access (not a case
that exists here — there is no sharing).
**Why:** a 403 is an existence oracle. Articles keep 403 because they are
public and there is nothing to hide.
**Consequence worth monitoring:** a rising 404 rate on `/api/collections/:id`
from one source is the signature of someone enumerating, and it is in the
design note as an alert.

### Constraints in the database instead of checks in the service

**Chose:** primary key and unique index.
**Rejected:** `findOne` then `create`.
**Why:** check-then-act loses races. The concurrency test would fail against
the application-level version.
**Cost:** the error arrives as a Sequelize exception that has to be
translated, which is what `rejectDuplicate` does.

### Extending `errorHandler` to always throw

**Chose:** every failure throws; the thrown value is a plain string.
**Rejected:** throwing a rich `Error` carrying `error.status`.
**Why:** three existing screens render the thrown value straight into JSX, and
React will not render an `Error` object. The one caller that needs the status
reads `error.response.status` itself.
**Cost:** callers that want structured information have to look at the axios
error before delegating. That is arguably the better boundary anyway — what a
409 means is endpoint-specific.

### Leaving the existing endpoints alone

**Chose:** did not fix the N+1 in `/api/articles`, did not change its
page-based `offset`, did not fix the seeder's plaintext passwords.
**Why:** the brief says not to break existing behaviour and warns against
unrelated rewrites. The frontend depends on the `offset` semantics today.
**How it is kept honest:** a characterization test pins the `offset`
behaviour so the inconsistency is a recorded decision rather than an
oversight, and every deviation is listed in the README.

### The linter is small on purpose

**Chose:** recommended rule sets, `react-hooks/set-state-in-effect` as a
warning, `react/prop-types` off.
**Why:** `set-state-in-effect` fires on the data-loading pattern the codebase
already uses in `useArticles`, `PopularTags` and `FeedContext`. Making it an
error would mean re-architecting existing screens. `prop-types` would mean
annotating every existing component.
**Result:** `eslint .` exits 0 with six warnings, all pre-existing patterns.

## 8. Debugging playbook

| Symptom | Look at | Why |
| --- | --- | --- |
| Backend test: *"Dialect needs to be explicitly supplied"* | `backend/tests/setupTests.js` | vitest runs from the repo root, so a bare `dotenv.config()` loads the root `.env` (4 compose variables) instead of `backend/.env` (23). The path is pinned for this reason. |
| Every token rejected, tests pass individually | require order in `setupTests.js` | `helper/jwt.js` reads `JWT_KEY` at require time. Anything requiring it before dotenv gets `undefined`. |
| *"Vitest cannot be imported in a CommonJS module"* | the test file's imports | Backend is CJS. `globals: true` is set — use bare `describe`/`test`/`expect`/`vi`. |
| A 500 where a 4xx belongs | `middleware/errorHandler.js` → `statusFor` | An error class with no branch falls through to 500. Add the class, do not special-case the message. |
| A malformed id produces a 500 | `isUuid` in `services/collections.js` | Postgres raises a type error on a bad UUID. Validate before querying. |
| Collections list is empty for a user who has some | the `WHERE` clause | Almost always a missing or wrong `userId` scope, or the caller is not who you think. Check `req.loggedUser.id`. |
| Duplicate rows appeared in a collection | whether something used `collection.addArticle()` | The generated helper `SELECT`s then skips, and races. Use `CollectionArticle.create()`. |
| Response latency grew with page size | `loadArticlePage` | Something is querying inside the map. The query-count test should have caught it — check it was not skipped. |
| Article page renders blank after opening from a collection | the guard in `routes/Article/Article.jsx` | List endpoints omit `body`. The guard must be `state?.body`, not `state`. |
| Frontend test hangs or fails on an unexpected request | MSW handlers in the test | `onUnhandledRequest: "error"` — the component is calling something the test did not stub. |
| Pager shows a page with nothing on it | `goToPageAfterRemoval` | The page index was not clamped after a removal. |
| The picker shows stale membership | whether `CollectionPicker` is mounted while closed | It must mount on open; `ArticlesButtons` renders twice per page. |
| A save "worked" but nothing changed | `helpers/errorHandler.js` | This was the original bug: non-listed statuses were logged and swallowed, so the service resolved `undefined`. It now always throws. |
| CI fails on a shell script: *bad interpreter* | `.gitattributes` | A Windows checkout rewrote it to CRLF. |
| Playwright cannot find an element that is visibly there | the URL | The app uses `HashRouter`; every route is `/#/path`. |
| Playwright cannot find a pager link | the locator | `react-paginate` renders `role="button"` with `aria-label="Page N"`, not a link. |
| Seeded user cannot log in | `seeders/20220427123216-create-users.js` | Plaintext passwords vs a bcrypt comparison. Pre-existing. Register a new account. |

## 9. Making a small change

Worked recipes for the kinds of change most likely to come up.

### Add a field to a collection (say, `isPinned`)

1. **Migration** — a new file in `backend/migrations/`, `addColumn` with a
   default so existing rows are valid, and a `down` that removes it. Never
   edit an applied migration.
2. **Model** — add it to `Collection.init`, with a validator if it has rules.
3. **Whitelist** — add it to `readWritableFields` in `services/collections.js`.
   *If you skip this it silently will not save*, which is the whitelist doing
   its job.
4. **Read path** — add it to the `attributes` arrays in `listCollections` and
   `findOwnedCollection`. They are explicit lists, not `SELECT *`.
5. **Tests** — one that it round-trips, one that an invalid value is 422.
6. **Frontend** — `CollectionForm` for the input, `Collections.jsx` to display.
7. `npm run lint && npm test`, and confirm `db:migrate:undo:all` then
   `db:migrate` still works.

### Add a route to the collections router

Add it to `routes/collections.js` — auth is inherited from `router.use`, so
do not add it per route. The auth test picks the new route up automatically
from the router's route table, but its assertion that there are eight routes
will fail: update the count, which is the prompt to confirm the new route
really should be there. Then the controller, then the service — and the
service function takes `userId` as its first concern and puts it in the
`WHERE` clause.

### Change the page size

`PAGE_LIMIT_DEFAULT` in `services/collections.js` and `PAGE_SIZE` in
`hooks/useCollectionArticles.js`. They are separate because the server's
default protects the API from a client that sends nothing, and the client's
value is a display choice. `PAGE_LIMIT_MAX` caps what a client may ask for;
raising it changes the worst case a single request can cost.

### Switch to keyset pagination

The ordering `(createdAt DESC, articleId DESC)` is already unique, so:

1. Accept `before` (an encoded `createdAt` + `articleId`) instead of `offset`
   in `parsePagination`.
2. In `loadArticlePage`, replace `offset` with
   `WHERE (createdAt, articleId) < (:beforeCreatedAt, :beforeArticleId)`.
   Postgres compares row constructors lexicographically, so this is one
   condition and the existing index serves it.
3. Return the last row's cursor in the response.
4. Swap `react-paginate` for a "load more" or prev/next control —
   **this is the real cost**, not the SQL.
5. Keep `articlesCount` for the total; it is independent of how pages are cut.

### Let users reorder articles in a collection

Add a `position` column to `CollectionArticles`, order by
`(position, createdAt DESC, articleId DESC)`, and extend the index to match.
The ordering already having a stable tiebreaker is what makes this safe to
add.

## 10. Evidence

Numbers here came from running the code, not from estimating. Re-run them
after a change rather than trusting this table.

| Claim | How it was produced | Result |
| --- | --- | --- |
| Migrations reproduce the pre-existing schema exactly | `./scripts/verify-baseline-schema.sh` | empty diff, 114 lines each |
| Collection page cost is flat | spy on `sequelize.query`, 1 vs 20 articles | 7 and 7 |
| Existing endpoint is N+1 | same method on `/api/articles` | 9 and 123 |
| Concurrent duplicate adds | `Promise.all` of two adds | one 201, one 409, one row |
| Constraints are in the database | raw `INSERT` of a duplicate; `Collection.create` with a blank name | both rejected |
| No field leakage | every collection response stringified and pattern-matched | no `userId`, `email`, `password`, `token`, `body` |
| Tests do not depend on order | `npx vitest run --sequence.shuffle` | passes |
| The whole flow works in a browser | Playwright against the production build | login → create → save → view → remove → empty state |

Suite sizes: **110 backend**, **48 frontend**, **2 end-to-end**.

## 11. Where the bodies are buried

Honest list of what is wrong, unfinished, or deliberately left alone. Nothing
here is a surprise waiting for a reviewer.

**Left alone on purpose** (out of scope; changing them would break or churn
existing behaviour):

- `/api/articles` and `/api/articles/feed` are still N+1.
- `offset` means pages there and rows here.
- Seeded users cannot log in (plaintext passwords vs bcrypt).
- `styles.css` asks for the Lora font; `index.html` never loads it.
- `DELETE /api/articles/:slug/comments/:commentId` ignores the slug. Ownership
  is still checked, so it is untidy, not exploitable.
- `Articles.userId` and `Comments.userId` are `ON DELETE SET NULL`, matching
  what the running schema always had, not what the models say.

**Not done, and would be next:**

- Keyset pagination and a stored counter.
- Rate limits on collection writes.
- Saving from a feed preview rather than only an article page.
- Collections cannot be searched, sorted or reordered.
- No `Cache-Control: private, no-store` header is set yet — it is argued for
  in the design note but not implemented.

**Things a reviewer might reasonably push back on:**

- The picker creates a collection and saves into it in **two** requests, so a
  failure between them leaves an empty collection. A single endpoint, or a
  transaction, would be better; two requests reuses two tested paths and the
  failure mode is benign.
- `goToPageAfterRemoval` derives the new page from `articlesCount` held in the
  hook, which is one render behind if two removals overlap. Removal is
  disabled per row while in flight, so it does not occur in practice, but it
  is a state machine that could be tightened.
- The frontend `errorHandler` throwing a bare string is not what most
  codebases do. It is the right call *here* because three existing screens
  render the thrown value directly, but it is a constraint inherited from the
  starter, not a preference.
