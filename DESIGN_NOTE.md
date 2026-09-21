# Design note: private article collections

Assuming this grows to millions of articles and hundreds of thousands of
users.

## Data model and API

Two tables. `Collections` holds `id` (UUID), `userId`, `name` (varchar 60),
`description` (varchar 280) and timestamps. `CollectionArticles` is the
membership join: `collectionId`, `articleId`, `createdAt`, with the composite
primary key `(collectionId, articleId)`.

The decisions worth defending:

**Both invariants live in the database.** The primary key on
`(collectionId, articleId)` is what makes a duplicate save impossible, and a
unique index on `(userId, lower(name))` is what stops one person owning two
collections the save picker cannot tell apart. Application checks would be
correct until the first concurrent request: a `SELECT` then `INSERT` has a
window between the two. The tests prove the point by firing two adds at once
(one 201, one 409) and by trying a raw `INSERT` that the database rejects.

**UUID collection ids.** Integer ids would be enumerable and would leak how
many collections exist in total. This is defence in depth, not the access
control — that is the owner in the `WHERE` clause. It also means the client
never needs a server round-trip to know an id is malformed, and a malformed
id is rejected before it reaches Postgres, where it would otherwise raise a
type error and surface as a 500.

**A collection that is not yours is a 404, not a 403.** A 403 confirms that
the id exists, which over private data is an oracle: an attacker who can tell
"exists but not yours" from "does not exist" can enumerate. Public articles
keep 403, because there is nothing to hide about their existence.

**Memberships reference `articleId`, not the slug.** Slugs change when a
title is edited; the saved article should survive that. Deletion cascades, so
no read has to filter out articles that no longer exist.

**The API mirrors the existing conventions** — `{ collection: ... }` envelopes,
the `{ errors: { body: [...] } }` error shape, and the same
`{ articles, articlesCount }` response as `/api/articles` so the existing list
components render it unchanged. The one deliberate difference is that `limit`
and `offset` count rows rather than pages, because `offset * limit` is
surprising and capping `limit` at 50 matters more than consistency with a
quirk. The old endpoints were left alone rather than changed underneath
working screens.

## Keeping reads efficient as data grows

**Today: a fixed query count per page.** One query returns the page of
memberships joined to their articles and authors; then one query each for
tags, favourite counts and follow counts across the whole page using
`IN (...)`. Seven queries whether the page holds 1 article or 20 — measured,
and asserted by a test that would fail if a loop crept back in. For contrast,
the existing `/api/articles` handler issues about six queries per article:
123 for a page of 20.

**Indexes.** `(collectionId, createdAt DESC)` means the detail page reads
straight off the index in the order it displays. A separate index on
`articleId` exists because the composite primary key starts with
`collectionId` and cannot serve the reverse lookup — without it, deleting a
popular article scans the whole membership table to cascade.

**What changes at scale.**

*Keyset pagination.* `OFFSET n` makes Postgres walk and discard `n` rows, so
page 500 costs 500 rows of work before it returns anything. Ordering is
already `(createdAt DESC, articleId DESC)`, which is unique, so switching to
`WHERE (createdAt, articleId) < (:lastCreatedAt, :lastArticleId)` is a
same-shape change that makes every page cost the same as the first. It also
fixes the correctness bug `OFFSET` has: if an article is removed while
someone is paging, `OFFSET` shifts everything up and a row is skipped.

*A stored `articlesCount`.* Today it is `COUNT(*)` per collection per request.
That is an index-only scan on a small set and is not the bottleneck yet, but
it is `O(memberships)` and the list page pays it once per collection. The
replacement is a counter column on `Collections` maintained in the same
transaction as the insert or delete. The awkward case is `ON DELETE CASCADE`
on article deletion, which bypasses application code — so the counter needs a
row-level trigger on `CollectionArticles`, or the cascade has to become an
explicit application-level delete. A trigger is the safer of the two because
it cannot be bypassed, and a periodic reconciliation job catches drift.

*Partitioning* only becomes interesting if `CollectionArticles` reaches the
low billions; by `userId` range, since every query is already owner-scoped.

## Caching

**Nothing, at first.** The data is per-user, private, small and already cheap
to read. A shared cache over private data is exactly where authorization bugs
come from — one mis-scoped key and a user sees someone else's list. The cost
of getting it wrong is much higher than the query it saves.

Collection responses send `Cache-Control: private, no-store` so no proxy or
shared browser cache holds them.

**If it were needed,** in order of safety:

1. **Article preview data keyed by `articleId`** — slug, title, description,
   author, tags. This is the same for everybody, so it is safe to share.
   Invalidated on article update or delete, and by a short TTL as a backstop
   for anything that writes to articles outside the normal path.
2. **Favourite counts on a short TTL** (30–60s). They are approximate by
   nature and nobody is harmed by a count that is a minute stale.
3. **Per-user membership sets**, only if the save picker becomes hot. Keyed by
   `userId` and invalidated on every write by that user. This is the one that
   needs care, because the key is the only thing keeping one user's data away
   from another's.

What is deliberately *not* cached is the ownership check. It is one indexed
lookup and it is the thing that must never be stale.

## What to monitor

- **Latency p95 and p99 per route.** The detail page is the one that will
  degrade first, and it will degrade on deep pages before shallow ones — so
  the offset distribution is worth a histogram of its own.
- **Error rate by status, per route.** 5xx is the alert. 404 is the
  interesting one: a rising 404 rate on `/api/collections/:id` from a single
  user or IP means somebody is probing ids, which is precisely the signal the
  404-not-403 decision was designed to make visible rather than useful.
- **409 rate on adds.** A slow rise means double-submits — probably a UI
  regression where the button stopped disabling, or an optimistic update that
  stopped reflecting server state.
- **Queries per request** on the collection endpoints, alarmed on any increase
  above the constant. This is the metric that catches a reintroduced N+1 in
  production if the test is ever deleted or skipped.
- **Growth of `CollectionArticles`**, and the distribution of collection
  sizes. A user with a million-row collection is either an abuse case or a
  product signal, and either way the pagination assumptions need revisiting.
- **Constraint violation counts** from Postgres. A unique-violation rate that
  is not matched by 409s returned means something is swallowing them.

## The trade-off made for the three-day window

**`OFFSET` pagination and a computed `articlesCount`, instead of keyset
pagination and a stored counter.**

Keyset pagination needs a different client contract — the client sends the
last row's cursor rather than a page number — which means the pager component
changes shape, the URL changes, and the tests change with them. A stored
counter needs a trigger, a backfill and a reconciliation job to be trustworthy,
and a counter that silently drifts is worse than a `COUNT(*)`.

Neither is a bottleneck at the size this application is at, both are contained
changes when they are needed, and the ordering is already unique so keyset is
a drop-in. Spending the time on the ownership tests and the constant query
count was the better use of it: those are the things that are expensive to
retrofit and dangerous to get wrong.

## Given two more days

1. **Keyset pagination and a stored `articlesCount`** — the trade-off above,
   with the trigger and the reconciliation job.
2. **Rate limits on collection writes.** There is nothing stopping a script
   creating collections in a loop. Per-user token bucket on the write routes.
3. **Save from feed previews**, not just the article page. The picker already
   works; what it needs is one batched membership lookup for the whole visible
   page rather than one request per card, which is the same `IN (...)` shape
   used elsewhere.
4. **The same batching fix for `/api/articles` and `/api/articles/feed`.**
   123 queries for a page of 20 is the single worst thing in this codebase,
   and the collection endpoints are now a working template for fixing it
   without changing the response shape.
5. **A composite index on `Favorites(articleId, userId)`** and the equivalent
   on `Followers`, which the batched lookups would then read directly.
6. **Reordering articles within a collection**, which is the most obvious
   missing product capability — and the reason the membership table has its
   own surrogate ordering column ready in `createdAt`.
