const request = require("supertest");
const app = require("../app");
const { Article, Collection, CollectionArticle } = require("../models");
const { createArticle, createCollection, createUser } = require("./factories");

describe("Collections: CRUD and validation", () => {
  let owner;

  beforeEach(async () => {
    owner = await createUser();
  });

  describe("create", () => {
    test("creates a collection and returns 201", async () => {
      const res = await request(app)
        .post("/api/collections")
        .set(owner.headers)
        .send({
          collection: { name: "Reading list", description: "For later" },
        });

      expect(res.status).toBe(201);
      expect(res.body.collection).toMatchObject({
        name: "Reading list",
        description: "For later",
      });
      expect(res.body.collection.id).toEqual(expect.any(String));
    });

    test("description is optional", async () => {
      const res = await request(app)
        .post("/api/collections")
        .set(owner.headers)
        .send({ collection: { name: "No description" } });

      expect(res.status).toBe(201);
      expect(res.body.collection.description).toBeNull();
    });

    test.each([
      ["missing name", {}],
      ["blank name", { name: "   " }],
      ["empty name", { name: "" }],
      ["name that is not a string", { name: 42 }],
      ["name over 60 characters", { name: "x".repeat(61) }],
      ["description over 280 characters", { name: "ok", description: "x".repeat(281) }],
      ["description that is not a string", { name: "ok", description: 42 }],
    ])("rejects %s with 422", async (_label, collection) => {
      const res = await request(app)
        .post("/api/collections")
        .set(owner.headers)
        .send({ collection });

      expect(res.status).toBe(422);
      expect(res.body.errors.body[0]).toEqual(expect.any(String));
      expect(await Collection.count()).toBe(0);
    });

    test("rejects a missing body with 422 rather than crashing", async () => {
      const res = await request(app)
        .post("/api/collections")
        .set(owner.headers)
        .send({});

      expect(res.status).toBe(422);
    });

    test("trims whitespace around the name", async () => {
      const res = await request(app)
        .post("/api/collections")
        .set(owner.headers)
        .send({ collection: { name: "  Padded  " } });

      expect(res.status).toBe(201);
      expect(res.body.collection.name).toBe("Padded");
    });

    test("rejects a second collection with the same name", async () => {
      await createCollection({ owner, name: "Reading list" });

      const res = await request(app)
        .post("/api/collections")
        .set(owner.headers)
        .send({ collection: { name: "Reading list" } });

      expect(res.status).toBe(409);
      expect(await Collection.count()).toBe(1);
    });

    test("name uniqueness ignores case", async () => {
      await createCollection({ owner, name: "Reading List" });

      const res = await request(app)
        .post("/api/collections")
        .set(owner.headers)
        .send({ collection: { name: "reading list" } });

      expect(res.status).toBe(409);
    });

    test("two users may each have a collection with the same name", async () => {
      const other = await createUser();
      await createCollection({ owner, name: "Reading list" });

      const res = await request(app)
        .post("/api/collections")
        .set(other.headers)
        .send({ collection: { name: "Reading list" } });

      expect(res.status).toBe(201);
    });

    test("a blank name cannot be inserted directly either", async () => {
      //? Proves the rule lives in the database, not only in the service.
      await expect(
        Collection.create({ userId: owner.id, name: "   " }),
      ).rejects.toThrow();
    });
  });

  describe("list", () => {
    test("returns the owner's collections, newest first, with counts", async () => {
      const older = await createCollection({ owner, name: "Older" });
      const newer = await createCollection({ owner, name: "Newer" });
      await Collection.update(
        { createdAt: new Date(Date.now() - 60_000) },
        { where: { id: older.id } },
      );

      const article = await createArticle({ author: owner });
      await CollectionArticle.create({
        collectionId: newer.id,
        articleId: article.id,
      });

      const res = await request(app).get("/api/collections").set(owner.headers);

      expect(res.status).toBe(200);
      expect(res.body.collections.map((c) => c.name)).toEqual([
        "Newer",
        "Older",
      ]);
      expect(res.body.collections[0].articlesCount).toBe(1);
      expect(res.body.collections[1].articlesCount).toBe(0);
    });

    test("is an empty list for a user with no collections", async () => {
      const res = await request(app).get("/api/collections").set(owner.headers);

      expect(res.status).toBe(200);
      expect(res.body.collections).toEqual([]);
    });

    test("?article=<slug> adds hasArticle for the save picker", async () => {
      const withArticle = await createCollection({ owner, name: "Has it" });
      await createCollection({ owner, name: "Does not" });
      const article = await createArticle({ author: owner });
      await CollectionArticle.create({
        collectionId: withArticle.id,
        articleId: article.id,
      });

      const res = await request(app)
        .get(`/api/collections?article=${article.slug}`)
        .set(owner.headers);

      expect(res.status).toBe(200);
      const byName = Object.fromEntries(
        res.body.collections.map((c) => [c.name, c.hasArticle]),
      );
      expect(byName).toEqual({ "Has it": true, "Does not": false });
    });

    test("?article=<unknown slug> reports hasArticle false everywhere", async () => {
      await createCollection({ owner, name: "Anything" });

      const res = await request(app)
        .get("/api/collections?article=no-such-article")
        .set(owner.headers);

      expect(res.status).toBe(200);
      expect(res.body.collections[0].hasArticle).toBe(false);
    });
  });

  describe("read, update and delete", () => {
    test("reads a collection by id", async () => {
      const collection = await createCollection({ owner, name: "Mine" });

      const res = await request(app)
        .get(`/api/collections/${collection.id}`)
        .set(owner.headers);

      expect(res.status).toBe(200);
      expect(res.body.collection.name).toBe("Mine");
      expect(res.body.collection.articlesCount).toBe(0);
    });

    test("404s an id that is not a UUID rather than raising a 500", async () => {
      //? Postgres rejects a malformed uuid with a type error, which would
      //? surface as a 500 and hand the caller a database message.
      const res = await request(app)
        .get("/api/collections/not-a-uuid")
        .set(owner.headers);

      expect(res.status).toBe(404);
    });

    test("404s a well-formed id that does not exist", async () => {
      const res = await request(app)
        .get("/api/collections/3f3ec2b8-1f9a-4a1e-93a3-2b52f7d7c2aa")
        .set(owner.headers);

      expect(res.status).toBe(404);
    });

    test("renames a collection and edits its description", async () => {
      const collection = await createCollection({ owner, name: "Before" });

      const res = await request(app)
        .put(`/api/collections/${collection.id}`)
        .set(owner.headers)
        .send({ collection: { name: "After", description: "New text" } });

      expect(res.status).toBe(200);
      expect(res.body.collection).toMatchObject({
        name: "After",
        description: "New text",
      });
    });

    test("an update is partial: sending only a description keeps the name", async () => {
      const collection = await createCollection({ owner, name: "Keep me" });

      const res = await request(app)
        .put(`/api/collections/${collection.id}`)
        .set(owner.headers)
        .send({ collection: { description: "Only this" } });

      expect(res.status).toBe(200);
      expect(res.body.collection.name).toBe("Keep me");
      expect(res.body.collection.description).toBe("Only this");
    });

    test("a description can be cleared with null", async () => {
      const collection = await createCollection({
        owner,
        name: "Clear me",
        description: "Something",
      });

      const res = await request(app)
        .put(`/api/collections/${collection.id}`)
        .set(owner.headers)
        .send({ collection: { description: null } });

      expect(res.status).toBe(200);
      expect(res.body.collection.description).toBeNull();
    });

    test("renaming onto another collection's name is a 409", async () => {
      await createCollection({ owner, name: "Taken" });
      const collection = await createCollection({ owner, name: "Free" });

      const res = await request(app)
        .put(`/api/collections/${collection.id}`)
        .set(owner.headers)
        .send({ collection: { name: "Taken" } });

      expect(res.status).toBe(409);
      await collection.reload();
      expect(collection.name).toBe("Free");
    });

    test("deletes a collection with 204 and leaves the articles alone", async () => {
      const collection = await createCollection({ owner });
      const article = await createArticle({ author: owner });
      await CollectionArticle.create({
        collectionId: collection.id,
        articleId: article.id,
      });

      const res = await request(app)
        .delete(`/api/collections/${collection.id}`)
        .set(owner.headers);

      expect(res.status).toBe(204);
      expect(await Collection.count()).toBe(0);
      expect(await CollectionArticle.count()).toBe(0);
      expect(await Article.count({ where: { id: article.id } })).toBe(1);
    });

    test("deleting twice is a 404 the second time", async () => {
      const collection = await createCollection({ owner });

      await request(app)
        .delete(`/api/collections/${collection.id}`)
        .set(owner.headers)
        .expect(204);

      await request(app)
        .delete(`/api/collections/${collection.id}`)
        .set(owner.headers)
        .expect(404);
    });
  });
});
