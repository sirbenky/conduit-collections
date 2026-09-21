const { QueryTypes, UniqueConstraintError } = require("sequelize");
const {
  ConflictError,
  NotFoundError,
  ValidationError,
} = require("../helper/customErrors");
const {
  Article,
  Collection,
  CollectionArticle,
  User,
  sequelize,
} = require("../models");

//? Every function here takes the owner's id and puts it in the WHERE clause.
//? Nothing loads a row first and compares owners afterwards: a query that
//? cannot return another user's row cannot leak one, and there is no window
//? between the read and the check. The controller never passes an owner id
//? that came from the request body.

const NAME_MAX = 60;
const DESCRIPTION_MAX = 280;
const PAGE_LIMIT_MAX = 50;
const PAGE_LIMIT_DEFAULT = 10;

//? Postgres is happy with an empty IN list only if we never build one.
const ARTICLE_COUNT = `(
  SELECT COUNT(*)::int FROM "CollectionArticles" ca
  WHERE ca."collectionId" = "Collection"."id"
)`;

const HAS_ARTICLE = `(
  SELECT EXISTS (
    SELECT 1 FROM "CollectionArticles" ca
    WHERE ca."collectionId" = "Collection"."id"
      AND ca."articleId" = :articleId
  )
)`;

//? A UUID that is not a UUID is a client mistake, not a server one, and
//? handing it to Postgres raises a type error that surfaces as a 500. The
//? caller turns false into the same 404 an unknown id gets, so probing for
//? valid-looking ids tells an attacker nothing.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value) => typeof value === "string" && UUID_PATTERN.test(value);

//? Only these two fields are writable. A userId in the request body is not
//? ignored by accident - it never reaches the update at all.
function readWritableFields(payload = {}, { partial = false } = {}) {
  const fields = {};

  if (payload.name !== undefined) {
    if (typeof payload.name !== "string") {
      throw new ValidationError("A collection name is required");
    }
    const name = payload.name.trim();
    if (!name) throw new ValidationError("A collection name is required");
    if (name.length > NAME_MAX) {
      throw new ValidationError(
        `A collection name must be ${NAME_MAX} characters or fewer`,
      );
    }
    fields.name = name;
  } else if (!partial) {
    throw new ValidationError("A collection name is required");
  }

  if (payload.description !== undefined && payload.description !== null) {
    if (typeof payload.description !== "string") {
      throw new ValidationError("A description must be text");
    }
    const description = payload.description.trim();
    if (description.length > DESCRIPTION_MAX) {
      throw new ValidationError(
        `A description must be ${DESCRIPTION_MAX} characters or fewer`,
      );
    }
    fields.description = description || null;
  } else if (payload.description === null) {
    fields.description = null;
  }

  return fields;
}

function parsePagination({ limit, offset }) {
  //? Bounded integers, checked before they reach the database. Unlike the
  //? older endpoints, offset counts rows.
  const parsed = { limit: PAGE_LIMIT_DEFAULT, offset: 0 };

  if (limit !== undefined) {
    const value = Number(limit);
    if (!Number.isInteger(value) || value < 1 || value > PAGE_LIMIT_MAX) {
      throw new ValidationError(
        `limit must be a whole number between 1 and ${PAGE_LIMIT_MAX}`,
      );
    }
    parsed.limit = value;
  }

  if (offset !== undefined) {
    const value = Number(offset);
    if (!Number.isInteger(value) || value < 0) {
      throw new ValidationError("offset must be a whole number of 0 or more");
    }
    parsed.offset = value;
  }

  return parsed;
}

//? Sequelize raises UniqueConstraintError for both the (userId, lower(name))
//? index and the CollectionArticles primary key, so the caller says which
//? message fits.
async function rejectDuplicate(run, message) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof UniqueConstraintError) throw new ConflictError(message);
    throw error;
  }
}

async function listCollections({ userId, articleSlug }) {
  //? The picker needs to know which collections already hold the article it
  //? was opened from. Resolving the slug once here keeps the subquery on an
  //? integer id, and a slug that matches nothing simply means "in none".
  let articleId = null;
  if (articleSlug) {
    const article = await Article.findOne({
      attributes: ["id"],
      where: { slug: articleSlug },
    });
    articleId = article?.id ?? null;
  }

  const attributes = [
    "id",
    "name",
    "description",
    "createdAt",
    "updatedAt",
    [sequelize.literal(ARTICLE_COUNT), "articlesCount"],
  ];

  if (articleSlug) {
    attributes.push([
      //? Bound through replacements rather than interpolated, so the shape of
      //? the SQL never depends on a value that came in over the wire.
      sequelize.literal(articleId === null ? "FALSE" : HAS_ARTICLE),
      "hasArticle",
    ]);
  }

  return Collection.findAll({
    attributes,
    where: { userId },
    order: [["createdAt", "DESC"]],
    ...(articleId !== null && { replacements: { articleId } }),
  });
}

async function createCollection({ userId, payload }) {
  const fields = readWritableFields(payload);

  return rejectDuplicate(
    () => Collection.create({ ...fields, userId }),
    "A collection with that name already exists.",
  );
}

async function findOwnedCollection({ userId, id }) {
  //? 404 rather than 403 for a collection that is not yours. A 403 would
  //? confirm the id exists, which is a difference worth hiding for private
  //? data. Articles are public, so they stay 403 - that asymmetry is
  //? deliberate and noted in the README.
  if (!isUuid(id)) throw new NotFoundError("Collection");

  const collection = await Collection.findOne({
    attributes: [
      "id",
      "name",
      "description",
      "createdAt",
      "updatedAt",
      [sequelize.literal(ARTICLE_COUNT), "articlesCount"],
    ],
    where: { id, userId },
  });
  if (!collection) throw new NotFoundError("Collection");

  return collection;
}

async function updateCollection({ userId, id, payload }) {
  const fields = readWritableFields(payload, { partial: true });
  const collection = await findOwnedCollection({ userId, id });

  if (Object.keys(fields).length === 0) return collection;

  await rejectDuplicate(
    () => collection.update(fields),
    "A collection with that name already exists.",
  );

  return collection;
}

async function deleteCollection({ userId, id }) {
  if (!isUuid(id)) throw new NotFoundError("Collection");

  //? destroy() with the owner in the WHERE clause: one statement, no
  //? read-then-write gap. The memberships go with it through ON DELETE
  //? CASCADE; the articles themselves are untouched.
  const removed = await Collection.destroy({ where: { id, userId } });
  if (!removed) throw new NotFoundError("Collection");
}

async function addArticle({ userId, id, slug }) {
  const collection = await findOwnedCollection({ userId, id });

  if (typeof slug !== "string" || !slug.trim()) {
    throw new ValidationError("An article slug is required");
  }

  const article = await Article.findOne({
    attributes: ["id"],
    where: { slug: slug.trim() },
  });
  if (!article) throw new NotFoundError("Article");

  //? Written straight through the join model so the primary key decides.
  //? collection.addArticle() would SELECT first and skip a row that already
  //? exists, which reports success for a duplicate and still races a
  //? concurrent request between the SELECT and the INSERT.
  await rejectDuplicate(
    () =>
      CollectionArticle.create({
        collectionId: collection.id,
        articleId: article.id,
      }),
    "That article is already in this collection.",
  );

  return collection;
}

async function removeArticle({ userId, id, slug }) {
  const collection = await findOwnedCollection({ userId, id });

  const article = await Article.findOne({
    attributes: ["id"],
    where: { slug: String(slug ?? "").trim() },
  });
  if (!article) throw new NotFoundError("Article");

  const removed = await CollectionArticle.destroy({
    where: { collectionId: collection.id, articleId: article.id },
  });
  if (!removed) throw new NotFoundError("Article", "in this collection");
}

//? One query per kind of data, each over the whole page. The cost of a page
//? is the same whether it holds one article or fifty - no loop issues a
//? query. A test asserts that by counting statements.
async function loadArticlePage({ collectionId, loggedUserId, limit, offset }) {
  const memberships = await CollectionArticle.findAll({
    attributes: ["articleId", "createdAt"],
    where: { collectionId },
    include: [
      {
        model: Article,
        //? No body: a list does not need it, and it is the largest column.
        attributes: ["id", "slug", "title", "description", "createdAt"],
        include: [
          {
            model: User,
            as: "author",
            attributes: ["id", "username", "bio", "image"],
          },
        ],
      },
    ],
    //? articleId breaks ties so two articles saved in the same millisecond
    //? cannot swap places between page one and page two.
    order: [
      ["createdAt", "DESC"],
      ["articleId", "DESC"],
    ],
    limit,
    offset,
  });

  if (memberships.length === 0) return [];

  const articleIds = memberships.map((row) => row.articleId);
  const authorIds = [
    ...new Set(
      memberships.map((row) => row.Article?.author?.id).filter(Boolean),
    ),
  ];

  const [tagRows, favoriteRows, followRows] = await Promise.all([
    sequelize.query(
      `SELECT "articleId", "tagName"
         FROM "TagList"
        WHERE "articleId" IN (:articleIds)`,
      { replacements: { articleIds }, type: QueryTypes.SELECT },
    ),
    sequelize.query(
      `SELECT "articleId",
              COUNT(*)::int AS "favoritesCount",
              BOOL_OR("userId" = :loggedUserId) AS "favorited"
         FROM "Favorites"
        WHERE "articleId" IN (:articleIds)
        GROUP BY "articleId"`,
      { replacements: { articleIds, loggedUserId }, type: QueryTypes.SELECT },
    ),
    authorIds.length
      ? sequelize.query(
          `SELECT "userId" AS "authorId",
                  COUNT(*)::int AS "followersCount",
                  BOOL_OR("followerId" = :loggedUserId) AS "following"
             FROM "Followers"
            WHERE "userId" IN (:authorIds)
            GROUP BY "userId"`,
          {
            replacements: { authorIds, loggedUserId },
            type: QueryTypes.SELECT,
          },
        )
      : Promise.resolve([]),
  ]);

  const tagsByArticle = new Map();
  for (const { articleId, tagName } of tagRows) {
    if (!tagsByArticle.has(articleId)) tagsByArticle.set(articleId, []);
    tagsByArticle.get(articleId).push(tagName);
  }

  const favoritesByArticle = new Map(
    favoriteRows.map((row) => [row.articleId, row]),
  );
  const followsByAuthor = new Map(followRows.map((row) => [row.authorId, row]));

  return memberships.map(({ Article: article }) => {
    const favorites = favoritesByArticle.get(article.id);
    const follows = followsByAuthor.get(article.author?.id);

    //? Built by hand rather than serialised from the model, so a column
    //? added later cannot start appearing in responses on its own.
    return {
      slug: article.slug,
      title: article.title,
      description: article.description,
      createdAt: article.createdAt,
      tagList: tagsByArticle.get(article.id) ?? [],
      favorited: favorites?.favorited ?? false,
      favoritesCount: favorites?.favoritesCount ?? 0,
      author: article.author
        ? {
            username: article.author.username,
            bio: article.author.bio,
            image: article.author.image,
            following: follows?.following ?? false,
            followersCount: follows?.followersCount ?? 0,
          }
        : null,
    };
  });
}

async function listArticles({ userId, id, query }) {
  const { limit, offset } = parsePagination(query);
  const collection = await findOwnedCollection({ userId, id });

  const articlesCount = await CollectionArticle.count({
    where: { collectionId: collection.id },
  });

  const articles = await loadArticlePage({
    collectionId: collection.id,
    loggedUserId: userId,
    limit,
    offset,
  });

  return { articles, articlesCount, collection };
}

module.exports = {
  addArticle,
  createCollection,
  deleteCollection,
  findOwnedCollection,
  listArticles,
  listCollections,
  removeArticle,
  updateCollection,
  // exported for tests
  PAGE_LIMIT_MAX,
  parsePagination,
};
