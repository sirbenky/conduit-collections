const { Article, Collection, Tag, User } = require("../models");
const { bcryptHash } = require("../helper/bcrypt");
const { jwtSign } = require("../helper/jwt");

//? Names are unique per call so no test depends on another one's rows, and
//? files can be shuffled without collisions on the unique indexes.
let counter = 0;
const unique = (prefix) => `${prefix}${Date.now().toString(36)}${++counter}`;

const DEFAULT_PASSWORD = "correct-horse-battery-staple";

async function createUser(overrides = {}) {
  const username = overrides.username ?? unique("user");
  const email = overrides.email ?? `${username}@example.test`;
  const password = overrides.password ?? DEFAULT_PASSWORD;

  const user = await User.create({
    username,
    email,
    bio: overrides.bio ?? null,
    image: overrides.image ?? null,
    password: await bcryptHash(password),
  });

  const token = await jwtSign({ username, email });

  return {
    user,
    username,
    email,
    password,
    token,
    headers: { Authorization: `Token ${token}` },
  };
}

async function createArticle({ author, tags = [], ...overrides } = {}) {
  const title = overrides.title ?? unique("Article ");
  const slug = overrides.slug ?? title.trim().toLowerCase().replace(/\W|_/g, "-");

  const article = await Article.create({
    slug,
    title,
    description: overrides.description ?? `${title} description`,
    body: overrides.body ?? `${title} body`,
    userId: author?.id ?? null,
    ...(overrides.createdAt && { createdAt: overrides.createdAt }),
  });

  for (const name of tags) {
    const [tag] = await Tag.findOrCreate({ where: { name } });
    await article.addTagList(tag);
  }

  return article;
}

async function createCollection({ owner, ...overrides } = {}) {
  return Collection.create({
    userId: owner.id,
    name: overrides.name ?? unique("Collection "),
    description: overrides.description ?? null,
  });
}

module.exports = { createUser, createArticle, createCollection, unique, DEFAULT_PASSWORD };
