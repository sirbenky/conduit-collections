# Codebase guide

How the collections feature works, followed from the button a user clicks all
the way down to the database and back.

Written for an engineer who has not seen this code and needs to review it,
debug it, or build on it.

> **Keep this current.** Everything here should be checkable against the code
> as it stands. There are no line numbers on purpose, because they go stale;
> references are file plus function name instead. If you change how something
> works, change the matching part of this file in the same commit, and re-run
> the measurements in [Evidence](#8-evidence) rather than copying the old
> numbers forward.

---

## Contents

1. [What the feature is](#1-what-the-feature-is)
2. [Journey one: saving an article](#2-journey-one-saving-an-article)
3. [Journey two: opening a collection](#3-journey-two-opening-a-collection)
4. [Journey three: creating and deleting](#4-journey-three-creating-and-deleting)
5. [The ground underneath](#5-the-ground-underneath)
6. [Why it is built this way](#6-why-it-is-built-this-way)
7. [When something breaks](#7-when-something-breaks)
8. [Evidence](#8-evidence)
9. [Changing it](#9-changing-it)
10. [What is not done](#10-what-is-not-done)

---

## 1. What the feature is

The app is a Conduit/RealWorld blog. It already had users, articles,
comments, tags, favourites and follows. This work adds **collections**: named
lists of articles that belong to one person and that nobody else can see or
change.

A signed-in user can make a collection, rename it, delete it, and save
articles into it from any article page. The same article cannot go into the
same collection twice.

Here is the whole feature as a map. You will walk each of these paths in the
next three sections.

```
Browser                                Server                      Database
───────────────────────────────────────────────────────────────────────────
SaveToCollection  ─── POST ──▶  routes/collections.js
  CollectionPicker                  auth on the router
    services/*.js                 controllers/collections.js
      errorHandler                    services/collections.js ──▶ Postgres
                                        owner in every WHERE     constraints
Collections page  ─── GET ───▶      models/                      indexes
  useCollections                                                 migrations
CollectionDetail  ─── GET ───▶
  useCollectionArticles
```

Three ideas explain most of the design. Each one shows up in a journey below.

1. **The owner is always in the query, never checked afterwards.** Every
   collection query says `where: { id, userId }`, and that `userId` comes from
   a verified token, never from the request.
2. **The database enforces the rules that matter.** No duplicate article in a
   collection, no two collections with the same name per user. Both are
   constraints, not application checks, because application checks lose races.
3. **Reading a page costs a fixed number of queries.** It does not matter
   whether the page holds one article or fifty.

---

## 2. Journey one: saving an article

This is the fullest path in the feature. It starts in the browser and touches
every layer. Follow it once and the rest of the codebase makes sense.

### The user clicks Save

`components/SaveToCollection/SaveToCollection.jsx` renders the button. It sits
inside `ArticlesButtons`, which is the existing component that already holds
Follow, Favourite and the author's Edit and Delete buttons. Putting Save there
means it appears wherever those buttons already appear, and it renders nothing
at all for a signed-out visitor.

Clicking it opens the picker. Note *how* it opens:

```jsx
{open && (
  <div className="collection-picker-menu">
    <CollectionPicker onSaved={...} slug={slug} />
  </div>
)}
```

`CollectionPicker` is only mounted while the menu is open. That is deliberate.
`ArticlesButtons` renders **twice** on an article page, once in the banner and
once in the footer. If the picker held its own copy of "which collections
already have this article", the two copies would disagree the moment you used
one of them. Mounting on open means it always asks the server fresh. There is
a test for this that opens the picker twice and counts the requests.

### The picker asks what is already saved

`CollectionPicker` calls `useCollections({ articleSlug: slug })`, which calls
`services/getCollections.js`, which requests:

```
GET /api/collections?article=how-to-train-your-dragon
```

The `?article=` part matters. Without it the picker would know your
collections but not which ones already contain this article, and it would need
one extra request per collection to find out. With it, the server answers both
questions at once.

### The server answers, cheaply

`services/collections.js` → `listCollections` first turns the slug into an
article id with one small query, then builds the list:

```js
// Abbreviated - hasArticle and replacements are only added when ?article= was sent.
attributes: [
  "id", "name", "description", "createdAt", "updatedAt",
  [sequelize.literal(ARTICLE_COUNT), "articlesCount"],
  [sequelize.literal(HAS_ARTICLE), "hasArticle"],
],
where: { userId },
replacements: { articleId },
```

`ARTICLE_COUNT` and `HAS_ARTICLE` are `SELECT` subqueries. The article id goes
in through `replacements`, not string concatenation, so the shape of the SQL
never depends on anything a user sent.

`where: { userId }` is the first appearance of idea number one. This query
cannot return somebody else's collection, so there is no ownership check to
write and no way to forget to write it.

If the slug matches no article, `HAS_ARTICLE` is replaced by the literal
`FALSE` rather than a subquery. A slug that does not exist means "in none of
them", which is a correct answer, not an error.

### The user clicks a collection, and the UI moves first

Back in `CollectionPicker` → `handleToggle`. The tick appears immediately,
before the server has replied:

```js
const wasSaved = Boolean(collection.hasArticle);
setCollections(previous => previous.map(item =>
  item.id === collection.id
    ? { ...item, hasArticle: !wasSaved, articlesCount: item.articlesCount + (wasSaved ? -1 : 1) }
    : item));
```

This is an optimistic update. A tick that lags behind the cursor feels broken,
so the UI guesses and corrects itself afterwards. `wasSaved` is captured
*before* the guess, which is what makes the correction possible: if the
request fails, the `catch` block puts both the tick and the count back exactly
as they were, and shows the error.

Forms elsewhere in this feature do the opposite and wait for the server.
Section 4 explains why they differ.

### The request goes out

`services/toggleCollectionArticle.js` sends:

```
POST /api/collections/:id/articles     { "article": { "slug": "..." } }
```

Add and remove live in one service function because the picker is a toggle and
because the two "already in that state" cases belong together. That will
matter in a moment.

### It arrives, and is authenticated once

`app.js` mounts the router. Note that `app.js` only *builds* the Express app —
`index.js` is the only file that calls `listen()`. They were one file
originally, which is why the project had no API tests: you cannot import a
module that starts a server. Splitting them is what lets Supertest do
`require("../app")`.

`routes/collections.js` starts with:

```js
router.use(verifyToken, requireAuth);
```

Auth is on the **router**, not on each route. `verifyToken` identifies the
caller if a token is present and leaves `req.loggedUser` undefined if not,
because public routes elsewhere in the app rely on that behaviour.
`requireAuth` then rejects anyone still anonymous.

Attaching it once means a route added below inherits the check automatically,
instead of depending on whoever adds it to remember. To stop that guarantee
rotting, `tests/collections.auth.test.js` reads the route table out of the
router object itself and asserts that every entry returns 401. Add a route,
and it is covered before you have written a test for it.

Two bugs in `verifyToken` were fixed on the way past. A malformed header threw
a `SyntaxError` that the error handler had no branch for, so a plainly
client-side mistake came back as a 500. And a token belonging to a
since-deleted user called `next()` twice, because of a missing `return`, so
Express ran the route handler *and* the error handler.

### The controller does almost nothing

`controllers/collections.js` → `addArticle`:

```js
const collection = await collections.addArticle({
  userId: req.loggedUser.id,        // from the verified token
  id: req.params.id,
  slug: req.body?.article?.slug,
});
res.status(201).json({ collection });
```

Three jobs: read the request, call the service, choose a status code. No
queries here, and no business rules.

The important line is the first one. `userId` comes from `req.loggedUser`,
which `verifyToken` set from a signature-verified token. **No controller in
this feature reads an owner id from params, query or body.** There is
therefore nothing for a client to substitute. Two tests put a `userId` in the
request body, on create and on update, and check it is ignored.

### The service finds the collection, scoped to you

`services/collections.js` → `addArticle` starts by calling
`findOwnedCollection`:

```js
// Abbreviated - the real call also lists the attributes to select.
if (!isUuid(id)) throw new NotFoundError("Collection");
const collection = await Collection.findOne({ where: { id, userId } });
if (!collection) throw new NotFoundError("Collection");
```

Three separate things are happening in those three lines.

**The UUID is checked before Postgres sees it.** Hand Postgres a malformed
UUID and it raises a type error, which would surface as a 500 with a database
message attached. Checking first turns it into a 404.

**The owner is in the `WHERE` clause.** The query is incapable of returning
another user's row. Compare that with the version you might write by instinct:

```js
// Not what this codebase does, and why:
const collection = await Collection.findByPk(id);
if (collection.userId !== req.loggedUser.id) throw new ForbiddenError();
```

That version reads somebody else's row into memory and then relies on a
comparison to throw it away. Two problems: the comparison can be forgotten or
written wrong, and the 403 it throws confirms the collection exists.

**Someone else's collection and a missing one look identical.** A collection
that exists but is not yours produces exactly the same `NotFoundError` as one
that never existed. A 403
would tell an attacker "this id is real, just not yours", which is a yes/no
oracle they can run over any id they like. Articles keep 403, because they are
public and there is nothing to hide about whether they exist.

### The slug becomes an article id

```js
const article = await Article.findOne({ attributes: ["id"], where: { slug } });
```

Memberships point at `articleId`, never at the slug. Slugs are derived from
titles, so editing a title changes the slug. Storing the id means a saved
article survives being renamed.

### The database decides about duplicates

This is the part most worth understanding.

```js
await rejectDuplicate(
  () => CollectionArticle.create({ collectionId, articleId }),
  "That article is already in this collection.",
);
```

Sequelize generates `collection.addArticle()` for a `belongsToMany`
relationship, and it is the obvious thing to reach for. Do not. It runs a
`SELECT` first and **silently skips** a row that already exists. Two
consequences: a duplicate save reports success, and two requests arriving
together can both pass the `SELECT` before either one `INSERT`s.

Writing through the join model instead lets the composite primary key
`(collectionId, articleId)` make the decision. `rejectDuplicate` catches
Sequelize's `UniqueConstraintError` and rethrows a `ConflictError`.

Two tests hold this down. One fires two adds with `Promise.all` and asserts
exactly one 201, one 409, and one row. The other bypasses the ORM entirely
with a raw `INSERT` and checks the database rejects it, which proves the rule
lives in the schema rather than in the service.

### The error becomes a status code

`middleware/errorHandler.js` maps error type to status: 401 for
`UnauthorizedError` and the three jsonwebtoken errors, 403 for
`ForbiddenError`, 404 for `NotFoundError`, 409 for `ConflictError` and
`SequelizeUniqueConstraintError`, 422 for validation, 500 for anything else.

It logs the error's **name, message and stack**, not the error object. That is
not fussiness. A Sequelize error carries the failing SQL and its bound
parameters in ordinary enumerable fields, so logging the object writes
password hashes and tokens into your log aggregator. For the same reason, a
500 returns a generic message instead of echoing the internal one.

So the response is `409 { "errors": { "body": ["That article is already in this collection."] } }`.

### The client decides a 409 is a success

Back in `services/toggleCollectionArticle.js`:

```js
if (!saved && status === 409) return { saved: true,  alreadyDone: true };
if (saved && status === 404) return { saved: false, alreadyDone: true };
```

A 409 on add means the article is already there. A 404 on remove means it is
already gone. In both cases the server is in the state the user asked for, so
treating them as errors would be wrong. This is what makes a double click, or
the same article saved in a second browser tab, settle down quietly instead of
showing a failure for something that worked.

Notice where that judgement lives: in the service that knows this endpoint,
not in the shared `errorHandler`. The shared handler has no business knowing
what a 409 means here, because it means something different everywhere else.

### Everything else throws

`helpers/errorHandler.js` now throws on every failure. It used to rethrow only
for 401, 403, 404, 422 and 500. Anything else — a 409, a 400, a dropped
connection — was logged and swallowed, so the calling service resolved
`undefined` and the screen carried on as though the request had worked. A save
that silently did nothing is the worst failure mode available.

It throws a plain **string**, not an `Error`. That looks wrong until you look
at the callers: `AuthPageContainer`, `ArticleEditorForm` and `Login` all
render the thrown value straight into JSX with `<li>{error}</li>`, and React
refuses to render an `Error` object. The constraint is inherited from the
starter app, not chosen.

### The UI settles

`handleToggle` takes the `saved` value the service reports and writes *that*
into state, rather than keeping its optimistic guess. When the guess was wrong
— a 409 meaning it was already saved — the UI ends up correct anyway. The
button label flips from Save to Saved, and the E2E test uses exactly that flip
as its signal that the write came back, which is why it contains no fixed
waits.

---

## 3. Journey two: opening a collection

The second path is a read. It is shorter, and its whole point is what it costs.

### The page loads

`routes/Collections/CollectionDetail.jsx` makes two requests: one for the
collection itself, one for the first page of its articles via
`useCollectionArticles`.

That hook, and `useCollections` beside it, are modelled on the app's existing
`useArticles` with two additions.

**They have an error state.** `useArticles` does `.catch(console.error)`, so a
failed load renders as an empty list. "You have no collections" and "we could
not load your collections" then look identical to the user, which is a bad way
to find out your API is down. Both new hooks tell them apart, and there are
tests for each state.

**They ignore stale responses.** Each effect sets `let current = true` and
flips it in its cleanup:

```js
return () => { current = false; };
```

Only the newest effect can write to state. Without this, a slow response for
page 2 that lands after page 3 would put page 2's rows on screen while the
pager still reads 3.

### The server reads one page, and no more queries than that

`services/collections.js` → `listArticles` scopes the collection to the owner
again, counts the memberships, then hands off to `loadArticlePage`, which is
the interesting function.

The obvious way to build this response is to fetch the page and then, for each
article, fetch its tags, its favourite count, whether you favourited it, and
whether you follow the author. That is what the app's existing
`/api/articles` handler does, at roughly six queries per article.

Measured on this machine:

| Endpoint | page of 1 | page of 20 |
| --- | --- | --- |
| `GET /api/articles` (existing) | 9 | **123** |
| `GET /api/collections/:id/articles` | 7 | **7** |

`loadArticlePage` gets there like this:

1. **One** query for the page of memberships, joined to their articles and
   authors, ordered and limited.
2. Return early if the page is empty, so no `IN ()` with nothing in it is ever
   built.
3. Collect the article ids and the distinct author ids from that page.
4. **Three** queries in parallel, each covering the whole page at once:
   - tags: `WHERE "articleId" IN (:articleIds)`
   - favourites: `COUNT(*)` and `BOOL_OR("userId" = :loggedUserId)`, grouped
     by article
   - follows: the same shape over `Followers`, grouped by author
5. Index those into `Map`s and assemble the response.

`BOOL_OR` earns its place: it answers "how many favourites" and "did *I*
favourite it" in one aggregate, instead of one query for the count and another
for the membership.

Those three are raw SQL because `Favorites`, `Followers` and `TagList` have no
Sequelize models — they are string-through join tables. Every value is bound
through `replacements`. Nothing is interpolated.

The ordering is `(createdAt DESC, articleId DESC)`. The second key is not
decoration. Without it, two articles saved in the same millisecond can swap
places between one request and the next, so one appears on both pages and the
other on neither.

A test spies on `sequelize.query` and asserts the count for a 1-article page
equals the count for a 20-article page. That is the tripwire for anyone who
later adds a convenient `await article.getTagList()` inside the loop.

### The response is built by hand

```js
return {
  slug, title, description, createdAt,
  tagList, favorited, favoritesCount,
  author: { username, bio, image, following, followersCount },
};
```

Nothing is spread out of a model. A column added to `Articles` next year
cannot start appearing in API responses on its own. The article `body` is left
out deliberately — a list never displays it and it is the largest column.

That omission has a consequence on the client, which is the next thing.

### The article page had to change

`ArticlesPreview` passes the whole article object as router state when you
click a row. `routes/Article/Article.jsx` used to read that and skip its fetch:

```js
if (state) return;          // before
if (state?.body) return;    // after
```

Because the collection endpoint sends no `body`, the old guard meant an
article opened from a collection rendered a title with no content and never
fetched. Three tests cover it: state without a body fetches, state with a body
does not, and no state fetches.

### Removing an article, and the pager

`handleRemove` calls the same toggle service from journey one, then
`goToPageAfterRemoval` clamps the page index:

```js
const remaining = articlesCount - 1;
const lastPage = Math.max(0, Math.ceil(remaining / PAGE_SIZE) - 1);
return Math.min(current, lastPage);
```

Remove the only article on the last page and, without this, the pager would
point at a page that no longer exists: an empty list under a pager insisting
there is more. Tested with 11 articles across two pages.

The Remove button itself is one optional prop on the existing
`ArticlesPreview`:

```jsx
<ArticlesPreview articles={...} onRemove={handleRemove} removingSlug={removing} />
```

Without `onRemove`, that component renders exactly as it always did, so the
home, profile and favourites feeds are untouched.

---

## 4. Journey three: creating and deleting

The third path is the forms, and the thing to understand is why they behave
differently from the picker.

`routes/Collections/Collections.jsx` and `components/CollectionForm` handle
create, rename and delete. All three **wait for the server**, with submit
disabled while the request is in flight:

```jsx
<button disabled={submitting || !name.trim()} type="submit">
  {submitting ? "Saving..." : collection ? "Save changes" : "Create"}
</button>
```

The picker's toggles were optimistic. These are not, for three reasons. The
server owns the new collection's id, so there is nothing sensible to render
until it replies. The server can reject the name, because names are unique per
user. And a row that appears and then vanishes reads as a bug, in a way that a
tick that takes 200ms does not.

Disabling submit also means a double-clicked button sends one request. There
is a test that clicks twice and counts the POSTs.

When the server rejects a name it returns 409 with the message
`"A collection with that name already exists."`. Because `errorHandler` throws
the server's own message as a string, the form can render it directly with no
mapping layer.

Deleting asks for confirmation **inline**, not in a modal:

> Delete this collection? The articles stay where they are.

Inline matches the rest of the app, which has no modals. The wording says what
a user actually worries about at that moment, which is whether they are about
to lose the articles. They are not: deleting a collection removes the
memberships through `ON DELETE CASCADE` and leaves every article alone, and a
backend test asserts exactly that.

### One note on the picker's styling

The picker is the only genuinely new visual component in the feature.
Everything else is assembled from `ContainerRow`, `BannerContainer`,
`FormFieldset`, `.article-preview` rows and the existing button classes. So it
is the only place where styling decisions had to be made rather than inherited:

- Its CSS is scoped under `.collection-picker` in `collections.css`. Defining
  `.dropdown-menu` globally would have restyled the navbar user menu, which
  currently has no styles of its own.
- It reuses the radius and shadow `.card` already uses. No new visual values,
  and no hex codes anywhere in the new CSS.
- Escape and a click outside both close it and return focus to the button that
  opened it.
- Its focus ring is drawn with `box-shadow`, because `index.css` contains
  `button:focus { outline: 0 !important }` and a normal outline would be
  discarded.

---

## 5. The ground underneath

You have now walked every path. This is the schema they all sit on.

```
Users ──< Collections ──< CollectionArticles >── Articles
```

**`Collections`** — `id` UUID primary key, `userId`, `name` varchar(60) not
null, `description` varchar(280) nullable, timestamps.

| Constraint | Why |
| --- | --- |
| `CHECK (btrim(name) <> '')` | `NOT NULL` on its own still permits `"   "` |
| `UNIQUE (userId, lower(name))` | Two collections called "Reading list" in the picker would be a coin toss. Functional index, because Sequelize cannot express `lower(name)` |
| `userId ON DELETE CASCADE` | A deleted user's private lists have no other owner |

**`CollectionArticles`** — `collectionId`, `articleId`, `createdAt`.

| Feature | Why |
| --- | --- |
| Primary key `(collectionId, articleId)` | This *is* the duplicate prevention from journey one |
| No `updatedAt` | A membership is created and removed, never edited |
| Index `(collectionId, createdAt DESC)` | The detail page reads newest-first and comes straight off this index in display order |
| Index `(articleId)` | The primary key starts with `collectionId` and cannot serve the reverse lookup. Without this, deleting a popular article scans the whole table to cascade |

**Why UUIDs here but integers for articles.** Article ids are already
sequential and already effectively public through slugs. Collection ids go in
URLs for private data, where a sequential id is enumerable and leaks how many
exist in total. This is a second layer, not the actual control — the actual
control is the owner in the `WHERE` clause — but it costs nothing.

### The repair that came first

`migrations/20260921100000-baseline-add-missing-associations.js` is not part
of the feature. It is the fix that made the feature possible, and it is worth
knowing about because it explains a rule in `CLAUDE.md`.

The four original migrations create `Users`, `Articles`, `Comments` and
`Tags` — and none of the association columns or join tables. No
`Articles.userId`, no `Comments.articleId`, no `Favorites`, `Followers` or
`TagList`. The app ran anyway, because `index.js` called
`sequelize.sync({ alter: true })` on every boot and quietly added the missing
pieces.

That meant a database built from the committed migrations alone could not run
the app. The article seeder inserts into a `userId` column that no migration
creates.

The new migration adds exactly what `sync()` was building, including the
`ON DELETE` rules `sync()` actually emitted rather than the ones the models
ask for. Sequelize falls back to `SET NULL` for a nullable foreign key, so
`Articles.userId` and `Comments.userId` are `SET NULL` despite their models
saying `CASCADE`. Reproducing the real schema was the goal. Changing it would
have been a behaviour change disguised as a migration.

`scripts/verify-baseline-schema.sh` proves it: it builds one database with
`sync()`, one with the migrations, and diffs `pg_dump --schema-only`. The diff
is empty.

Boot no longer calls `sync()` at all. CI migrates up, all the way back down,
and up again, so an irreversible migration fails the build.

### The security boundaries, collected

Journeys one and two showed these individually. Here they are together, with
what enforces each and what proves it.

| Boundary | Enforced by | Proved by |
| --- | --- | --- |
| Anonymous cannot reach any collection route | `router.use(verifyToken, requireAuth)` | every route × three bad-auth cases, read off the router's own route table |
| A bad or expired token is 401, not 500 | `UnauthorizedError` and the JWT error names in `errorHandler` | malformed-token cases in the same test |
| B cannot read A's collection | `where: { id, userId }` | `collections.ownership.test.js` |
| B cannot write A's collection | the same clause on `update` and `destroy` | ownership tests re-read A's rows afterwards and assert they are unchanged |
| B cannot learn A's collection exists | `NotFoundError`, never `ForbiddenError` | ownership tests assert 404 |
| A client cannot set the owner | `userId` only from `req.loggedUser`; `readWritableFields` whitelists `name` and `description` | body-planting tests on create and update |
| A client cannot choose the id | `id` is not in the whitelist; the database default generates it | create test asserts the planted id was not used |
| No SQL injection | ORM throughout; the three raw queries use `replacements` | the raw queries are all in `loadArticlePage` |
| No field leakage | responses built by hand; `Collection.toJSON` drops `userId` | a test greps every response for `userId`, `email`, `password`, `token`, `body` |
| Secrets stay out of logs | `errorHandler` logs name, message and stack | review |

---

## 6. Why it is built this way

Each of these was a real choice with a real alternative. This is the section to
read before being asked "why did you…".

### `OFFSET` pagination rather than keyset

**Chose** `LIMIT`/`OFFSET`, offset in rows, capped at 50.
**Rejected** keyset pagination on `(createdAt, articleId)`.
**Why** keyset changes the client contract. The client sends a cursor instead
of a page number, so the pager component, the URL and their tests all change.
At this size `OFFSET` costs nothing.
**What it costs** page *n* makes Postgres walk and discard *n* rows. And if an
article is removed while someone is paging, everything shifts up by one and a
row gets skipped.
**When to revisit** when deep pages show up in the latency histogram, or on the
first report of a missing article while paging. The ordering is already
unique, so it is close to a drop-in.

### A computed `articlesCount` rather than a stored counter

**Chose** a `COUNT(*)` subquery per collection.
**Rejected** a counter column on `Collections`.
**Why** a counter has to survive `ON DELETE CASCADE` when an article is
deleted, and a cascade bypasses application code completely. Keeping it honest
needs a row-level trigger, a backfill and a reconciliation job. A counter that
drifts silently is worse than a count.
**When to revisit** when the list endpoint appears in slow queries.

### 404 rather than 403 for another user's collection

**Chose** 404.
**Why** a 403 confirms the id exists, which is an oracle over private data.
**What it costs** slightly confusing for a legitimate user who lost access,
which is not a case that exists here because there is no sharing.
**Worth monitoring** a rising 404 rate on `/api/collections/:id` from one
source is the signature of someone enumerating ids.

### Constraints in the database rather than checks in the service

**Chose** primary key and unique index.
**Rejected** `findOne` then `create`.
**Why** check-then-act loses races. The concurrency test would fail against the
application-level version.
**What it costs** the error arrives as a Sequelize exception that has to be
translated, which is what `rejectDuplicate` does.

### `errorHandler` throwing a plain string

**Chose** always throw; the thrown value is a string.
**Rejected** throwing an `Error` carrying `error.status`.
**Why** three existing screens render the thrown value straight into JSX, and
React will not render an `Error`.
**What it costs** callers wanting structured information have to inspect the
axios error before delegating. That is arguably the better boundary anyway,
since what a 409 means is specific to each endpoint.

### Leaving the existing endpoints alone

**Chose** did not fix the N+1 in `/api/articles`, did not change its page-based
`offset`, did not fix the seeder's plaintext passwords.
**Why** the brief says not to break existing behaviour and warns against
unrelated rewrites. The frontend depends on the `offset` semantics today.
**How it stays honest** a characterization test pins the `offset` behaviour, so
the inconsistency is a recorded decision rather than an oversight, and every
deviation is listed in the README.

### A deliberately small linter

**Chose** the recommended rule sets, `react-hooks/set-state-in-effect` as a
warning, `react/prop-types` off.
**Why** `set-state-in-effect` fires on the data-loading pattern the codebase
already uses in `useArticles`, `PopularTags` and `FeedContext`. Making it an
error would mean re-architecting existing screens. `prop-types` would mean
annotating every existing component.
**Result** `eslint .` exits 0 with six warnings, all pre-existing patterns.

---

## 7. When something breaks

| Symptom | Look at | Why |
| --- | --- | --- |
| Backend test: *"Dialect needs to be explicitly supplied"* | `backend/tests/setupTests.js` | vitest runs from the repo root, so a bare `dotenv.config()` loads the root `.env` (4 compose variables) instead of `backend/.env` (23). The path is pinned for this reason |
| Every token rejected, though tests pass individually | require order in `setupTests.js` | `helper/jwt.js` reads `JWT_KEY` at require time. Anything requiring it before dotenv gets `undefined` |
| *"Vitest cannot be imported in a CommonJS module"* | the test file's imports | The backend is CommonJS. `globals: true` is set, so use bare `describe`/`test`/`expect`/`vi` |
| A 500 where a 4xx belongs | `errorHandler` → `statusFor` | An error class with no branch falls through to 500. Add the class; do not special-case the message |
| A malformed id gives 500 | `isUuid` in `services/collections.js` | Postgres raises a type error on a bad UUID. Validate first |
| A user's collections list is empty when it should not be | the `WHERE` clause | Almost always a missing or wrong `userId` scope, or the caller is not who you think. Check `req.loggedUser.id` |
| Duplicate rows in a collection | whether something used `collection.addArticle()` | The generated helper `SELECT`s, then skips, and races. Use `CollectionArticle.create()` |
| Latency grows with page size | `loadArticlePage` | Something is querying inside the map. The query-count test should have caught it, so check it was not skipped |
| Article page blank when opened from a collection | the guard in `routes/Article/Article.jsx` | List endpoints omit `body`. The guard must be `state?.body`, not `state` |
| Frontend test hangs or fails on an unexpected request | the MSW handlers in that test | `onUnhandledRequest: "error"` — the component is calling something the test did not stub |
| Pager shows an empty page | `goToPageAfterRemoval` | The page index was not clamped after a removal |
| The picker shows stale membership | whether `CollectionPicker` stays mounted while closed | It must mount on open; `ArticlesButtons` renders twice per page |
| A save "worked" but nothing changed | `helpers/errorHandler.js` | The original bug: unlisted statuses were logged and swallowed, so the service resolved `undefined` |
| CI fails on a shell script: *bad interpreter* | `.gitattributes` | A Windows checkout rewrote it to CRLF |
| Playwright cannot find an element that is visibly there | the URL | The app uses `HashRouter`, so every route is `/#/path` |
| Playwright cannot find a pager link | the locator | `react-paginate` renders `role="button"` with `aria-label="Page N"`, not a link |
| A seeded user cannot log in | `seeders/20220427123216-create-users.js` | Plaintext passwords against a bcrypt comparison. Pre-existing; register a new account |

---

## 8. Evidence

These numbers came from running the code, not from estimating. Re-run them
after a change rather than trusting the table.

| Claim | How it was produced | Result |
| --- | --- | --- |
| Migrations reproduce the pre-existing schema | `./scripts/verify-baseline-schema.sh` | empty diff, 114 lines each side |
| Collection page cost is flat | spy on `sequelize.query`, 1 vs 20 articles | 7 and 7 |
| The existing endpoint is N+1 | the same method on `/api/articles` | 9 and 123 |
| Concurrent duplicate adds | `Promise.all` of two adds | one 201, one 409, one row |
| Constraints are in the database | raw `INSERT` of a duplicate; `Collection.create` with a blank name | both rejected |
| No field leakage | every collection response stringified and pattern-matched | no `userId`, `email`, `password`, `token` or `body` |
| Tests do not depend on order | `npx vitest run --sequence.shuffle` | passes |
| The flow works in a browser | Playwright against the production build | login → create → save → view → remove → empty state |

Suite sizes: **110 backend**, **48 frontend**, **2 end-to-end**.

---

## 9. Changing it

### Add a field to a collection, say `isPinned`

1. **Migration** — new file in `backend/migrations/`, `addColumn` with a
   default so existing rows stay valid, and a `down` that removes it. Never
   edit a migration that has already run.
2. **Model** — add it to `Collection.init`, with a validator if it has rules.
3. **Whitelist** — add it to `readWritableFields`. Skip this and it will
   silently fail to save, which is the whitelist doing its job.
4. **Read path** — add it to the `attributes` arrays in `listCollections` and
   `findOwnedCollection`. Those are explicit lists, not `SELECT *`.
5. **Tests** — one that it round-trips, one that an invalid value is 422.
6. **Frontend** — `CollectionForm` for the input, `Collections.jsx` to show it.
7. Run `npm run lint && npm test`, and check `db:migrate:undo:all` followed by
   `db:migrate` still works.

### Add a route

Add it to `routes/collections.js`. Auth is inherited from `router.use`, so do
not add it per route. The auth test picks the new route up automatically, but
its assertion that there are eight routes will fail — update the count, which
is your prompt to confirm the route really should exist. Then the controller,
then the service. The service function takes `userId` first and puts it in the
`WHERE` clause.

### Change the page size

`PAGE_LIMIT_DEFAULT` in `services/collections.js` and `PAGE_SIZE` in
`hooks/useCollectionArticles.js`. They are separate on purpose: the server's
default protects the API from a client that sends nothing, the client's value
is a display choice. `PAGE_LIMIT_MAX` caps what a client may ask for, so
raising it raises the worst case a single request can cost.

### Switch to keyset pagination

The ordering `(createdAt DESC, articleId DESC)` is already unique, so:

1. Accept `before` (an encoded `createdAt` plus `articleId`) instead of
   `offset` in `parsePagination`.
2. In `loadArticlePage`, replace `offset` with
   `WHERE (createdAt, articleId) < (:beforeCreatedAt, :beforeArticleId)`.
   Postgres compares row constructors lexicographically, so that is one
   condition and the existing index already serves it.
3. Return the last row's cursor in the response.
4. Replace `react-paginate` with prev/next or "load more". **This is the real
   cost**, not the SQL.
5. Keep `articlesCount`; it is independent of how pages are cut.

### Let users reorder articles

Add a `position` column to `CollectionArticles`, order by
`(position, createdAt DESC, articleId DESC)`, and extend the index to match.
The ordering already having a stable tiebreaker is what makes this safe.

---

## 10. What is not done

**Left alone deliberately**, because changing them would break or churn
existing behaviour:

- `/api/articles` and `/api/articles/feed` are still N+1.
- `offset` means pages there and rows here.
- Seeded users cannot log in — plaintext passwords against bcrypt.
- `styles.css` asks for the Lora font; `index.html` never loads it.
- `DELETE /api/articles/:slug/comments/:commentId` ignores the slug. Ownership
  is still checked, so it is untidy rather than exploitable.
- `Articles.userId` and `Comments.userId` are `ON DELETE SET NULL`, matching
  what the running schema always had rather than what the models say.

**Not built, and next in line:**

- Keyset pagination and a stored counter.
- Rate limits on collection writes.
- Saving from a feed preview rather than only an article page.
- Search, sort and manual reordering of collections.
- The `Cache-Control: private, no-store` header argued for in the design note.

**Fair things for a reviewer to push on:**

- The picker creates a collection and saves into it in **two** requests, so a
  failure between them leaves an empty collection. One endpoint, or a
  transaction, would be better. Two requests reuse two already-tested paths
  and the failure mode is harmless.
- `goToPageAfterRemoval` derives the new page from an `articlesCount` held in
  the hook, which is one render behind if two removals overlap. Removal is
  disabled per row while in flight so it does not happen in practice, but the
  state machine could be tighter.
- `errorHandler` throwing a bare string is not what most codebases do. It is
  right *here* because three existing screens render the thrown value
  directly, but it is a constraint inherited from the starter, not a
  preference.
