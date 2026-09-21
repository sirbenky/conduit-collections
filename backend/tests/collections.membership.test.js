const request = require("supertest");
const app = require("../app");
const {
  Article,
  CollectionArticle,
  sequelize,
} = require("../models");
const { createArticle, createCollection, createUser } = require("./factories");

describe("Collections: membership", () => {
  let owner;
  let collection;
  let article;

  beforeEach(async () => {
    owner = await createUser();
    collection = await createCollection({ owner });
    article = await createArticle({ author: owner });
  });

  const addArticle = (slug = article.slug) =>
    request(app)
      .post(`/api/collections/${collection.id}/articles`)
      .set(owner.headers)
      .send({ article: { slug } });

  describe("adding", () => {
    test("adds an article and returns 201", async () => {
      const res = await addArticle();

      expect(res.status).toBe(201);
      expect(await CollectionArticle.count()).toBe(1);
    });

    test("an author can save their own article", async () => {
      const own = await createArticle({ author: owner });

      await addArticle(own.slug).expect(201);
    });

    test("adding the same article twice is a 409 and leaves one row", async () => {
      await addArticle().expect(201);

      const second = await addArticle();

      expect(second.status).toBe(409);
      expect(await CollectionArticle.count()).toBe(1);
    });

    test("two concurrent adds produce one 201 and one 409", async () => {
      //? The duplicate is caught by the primary key, so the loser of the
      //? race gets a 409 rather than both requests appearing to succeed.
      //? A check-then-insert in application code would not survive this.
      const [first, second] = await Promise.all([addArticle(), addArticle()]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
      expect(await CollectionArticle.count()).toBe(1);
    });

    test("a duplicate cannot be forced in with a direct insert", async () => {
      await addArticle().expect(201);

      //? Proves the constraint is in the database, not just in the service.
      await expect(
        sequelize.query(
          `INSERT INTO "CollectionArticles" ("collectionId", "articleId", "createdAt")
           VALUES (:collectionId, :articleId, NOW())`,
          {
            replacements: {
              collectionId: collection.id,
              articleId: article.id,
            },
          },
        ),
      ).rejects.toThrow();

      expect(await CollectionArticle.count()).toBe(1);
    });

    test.each([
      ["a missing slug", {}],
      ["a blank slug", { slug: "   " }],
      ["a slug that is not a string", { slug: 7 }],
    ])("rejects %s with 422", async (_label, payload) => {
      const res = await request(app)
        .post(`/api/collections/${collection.id}/articles`)
        .set(owner.headers)
        .send({ article: payload });

      expect(res.status).toBe(422);
    });

    test("404s an article that does not exist", async () => {
      const res = await addArticle("no-such-article");

      expect(res.status).toBe(404);
    });
  });

  describe("removing", () => {
    test("removes an article with 204 and keeps the article itself", async () => {
      await addArticle().expect(201);

      const res = await request(app)
        .delete(`/api/collections/${collection.id}/articles/${article.slug}`)
        .set(owner.headers);

      expect(res.status).toBe(204);
      expect(await CollectionArticle.count()).toBe(0);
      expect(await Article.count({ where: { id: article.id } })).toBe(1);
    });

    test("404s an article that is not in the collection", async () => {
      const res = await request(app)
        .delete(`/api/collections/${collection.id}/articles/${article.slug}`)
        .set(owner.headers);

      expect(res.status).toBe(404);
    });

    test("deleting the article removes it from every collection", async () => {
      const second = await createCollection({ owner });
      await addArticle().expect(201);
      await request(app)
        .post(`/api/collections/${second.id}/articles`)
        .set(owner.headers)
        .send({ article: { slug: article.slug } })
        .expect(201);

      expect(await CollectionArticle.count()).toBe(2);

      await article.destroy();

      expect(await CollectionArticle.count()).toBe(0);
    });
  });

  describe("pagination", () => {
    //? Saved oldest first, so newest-first ordering is the reverse.
    const SAVED = ["first", "second", "third", "fourth", "fifth"];

    beforeEach(async () => {
      for (const [index, name] of SAVED.entries()) {
        const saved = await createArticle({ author: owner, title: name });
        await CollectionArticle.create({
          collectionId: collection.id,
          articleId: saved.id,
          createdAt: new Date(Date.now() + index * 1000),
        });
      }
    });

    const page = (query = "") =>
      request(app)
        .get(`/api/collections/${collection.id}/articles${query}`)
        .set(owner.headers);

    test("returns newest first with a total count", async () => {
      const res = await page();

      expect(res.status).toBe(200);
      expect(res.body.articlesCount).toBe(5);
      expect(res.body.articles.map((a) => a.title)).toEqual([
        "fifth",
        "fourth",
        "third",
        "second",
        "first",
      ]);
    });

    test("offset counts rows, not pages", async () => {
      //? Different from /api/articles on purpose. The README says so.
      const res = await page("?limit=2&offset=2");

      expect(res.body.articles.map((a) => a.title)).toEqual([
        "third",
        "second",
      ]);
      expect(res.body.articlesCount).toBe(5);
    });

    test("pages do not overlap or skip", async () => {
      const first = await page("?limit=2&offset=0");
      const second = await page("?limit=2&offset=2");
      const third = await page("?limit=2&offset=4");

      const seen = [...first.body.articles, ...second.body.articles, ...third.body.articles].map(
        (a) => a.title,
      );

      expect(seen).toEqual(["fifth", "fourth", "third", "second", "first"]);
      expect(new Set(seen).size).toBe(5);
    });

    test("an offset past the end is an empty page, not an error", async () => {
      const res = await page("?offset=99");

      expect(res.status).toBe(200);
      expect(res.body.articles).toEqual([]);
      expect(res.body.articlesCount).toBe(5);
    });

    test.each([
      "?limit=0",
      "?limit=51",
      "?limit=-1",
      "?limit=abc",
      "?limit=1.5",
      "?offset=-1",
      "?offset=abc",
    ])("rejects %s with 422", async (query) => {
      const res = await page(query);

      expect(res.status).toBe(422);
    });

    test("the article shape matches the list endpoints, without the body", async () => {
      const res = await page("?limit=1");
      const [first] = res.body.articles;

      expect(first).toEqual({
        slug: expect.any(String),
        title: "fifth",
        description: expect.any(String),
        createdAt: expect.any(String),
        tagList: [],
        favorited: false,
        favoritesCount: 0,
        author: {
          username: owner.username,
          bio: null,
          image: null,
          following: false,
          followersCount: 0,
        },
      });
    });

    test("favourite and follow state is reported for the caller", async () => {
      const reader = await createUser();
      const readerCollection = await createCollection({ owner: reader });
      const saved = await createArticle({ author: owner, tags: ["ops"] });
      await CollectionArticle.create({
        collectionId: readerCollection.id,
        articleId: saved.id,
      });

      await request(app)
        .post(`/api/articles/${saved.slug}/favorite`)
        .set(reader.headers)
        .expect(200);
      await request(app)
        .post(`/api/profiles/${owner.username}/follow`)
        .set(reader.headers)
        .expect(200);

      const res = await request(app)
        .get(`/api/collections/${readerCollection.id}/articles`)
        .set(reader.headers);

      expect(res.body.articles[0]).toMatchObject({
        favorited: true,
        favoritesCount: 1,
        tagList: ["ops"],
        author: { following: true, followersCount: 1 },
      });
    });

    test("a page costs the same number of queries whatever its size", async () => {
      //? The guard against reintroducing the N+1 loop that the existing
      //? article endpoints still have.
      const countQueries = async (limit) => {
        let count = 0;
        const spy = vi
          .spyOn(sequelize, "query")
          .mockImplementation(function (...args) {
            count += 1;
            return sequelize.constructor.prototype.query.apply(this, args);
          });

        await page(`?limit=${limit}`).expect(200);
        spy.mockRestore();

        return count;
      };

      const forOne = await countQueries(1);
      const forTwenty = await countQueries(20);

      expect(forTwenty).toBe(forOne);
    });
  });
});
