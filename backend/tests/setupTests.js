//? Order matters: NODE_ENV picks the config block, dotenv fills it in, and
//? only then can models/ open a connection. helper/jwt.js also reads JWT_KEY
//? at require time, so nothing may require it before this runs.
//?
//? The path is explicit because vitest runs from the repo root, where the
//? root .env (the docker compose one) would otherwise win and the backend
//? would come up with no database settings at all.
process.env.NODE_ENV = "test";
require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../.env"),
});

const { sequelize } = require("../models");

//? Every test starts from an empty database. TRUNCATE ... CASCADE with
//? RESTART IDENTITY is one statement, so it is far cheaper than deleting
//? through the models, and resetting the sequences stops a test from
//? accidentally depending on ids left behind by an earlier file.
const TABLES = [
  '"CollectionArticles"',
  '"Collections"',
  '"Favorites"',
  '"Followers"',
  '"TagList"',
  '"Comments"',
  '"Articles"',
  '"Tags"',
  '"Users"',
].join(", ");

beforeEach(async () => {
  await sequelize.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE;`);
});

afterAll(async () => {
  await sequelize.close();
});
