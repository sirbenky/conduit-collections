const request = require("supertest");
const app = require("../app");
const { Collection, CollectionArticle } = require("../models");
const { createArticle, createCollection, createUser } = require("./factories");

//? The single most important property of this feature: user B must not be
//? able to reach user A's collection by any route, with any identifier, and
//? must not be able to change A's data by trying.
describe("Collections: ownership boundaries", () => {
  let alice;
  let bob;
  let aliceCollection;
  let article;

  beforeEach(async () => {
    alice = await createUser();
    bob = await createUser();
    aliceCollection = await createCollection({
      owner: alice,
      name: "Alice private list",
      description: "Only Alice should see this",
    });
    article = await createArticle({ author: alice });
    await CollectionArticle.create({
      collectionId: aliceCollection.id,
      articleId: article.id,
    });
  });

  test("B does not see A's collections in their own list", async () => {
    const res = await request(app).get("/api/collections").set(bob.headers);

    expect(res.status).toBe(200);
    expect(res.body.collections).toEqual([]);
  });

  test("B gets 404, not 403, reading A's collection", async () => {
    //? 404 on purpose. A 403 would confirm that the id exists, which is a
    //? yes/no oracle over another user's private data.
    const res = await request(app)
      .get(`/api/collections/${aliceCollection.id}`)
      .set(bob.headers);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("Alice private list");
  });

  test("B gets 404 listing the articles in A's collection", async () => {
    const res = await request(app)
      .get(`/api/collections/${aliceCollection.id}/articles`)
      .set(bob.headers);

    expect(res.status).toBe(404);
  });

  test("B cannot rename A's collection", async () => {
    const res = await request(app)
      .put(`/api/collections/${aliceCollection.id}`)
      .set(bob.headers)
      .send({ collection: { name: "Bob was here" } });

    expect(res.status).toBe(404);

    await aliceCollection.reload();
    expect(aliceCollection.name).toBe("Alice private list");
  });

  test("B cannot delete A's collection", async () => {
    const res = await request(app)
      .delete(`/api/collections/${aliceCollection.id}`)
      .set(bob.headers);

    expect(res.status).toBe(404);
    expect(await Collection.count({ where: { id: aliceCollection.id } })).toBe(
      1,
    );
  });

  test("B cannot add an article to A's collection", async () => {
    const bobArticle = await createArticle({ author: bob });

    const res = await request(app)
      .post(`/api/collections/${aliceCollection.id}/articles`)
      .set(bob.headers)
      .send({ article: { slug: bobArticle.slug } });

    expect(res.status).toBe(404);
    expect(
      await CollectionArticle.count({
        where: { collectionId: aliceCollection.id },
      }),
    ).toBe(1);
  });

  test("B cannot remove an article from A's collection", async () => {
    const res = await request(app)
      .delete(`/api/collections/${aliceCollection.id}/articles/${article.slug}`)
      .set(bob.headers);

    expect(res.status).toBe(404);
    expect(
      await CollectionArticle.count({
        where: { collectionId: aliceCollection.id },
      }),
    ).toBe(1);
  });

  test("a userId in the request body is ignored on create", async () => {
    const res = await request(app)
      .post("/api/collections")
      .set(bob.headers)
      .send({
        collection: {
          name: "Planted",
          userId: alice.id,
          id: "11111111-1111-4111-8111-111111111111",
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.collection.userId).toBeUndefined();

    //? The row belongs to Bob whatever the body said, and the id the body
    //? tried to pick was not used either.
    const created = await Collection.findOne({ where: { name: "Planted" } });
    expect(created.userId).toBe(bob.id);
    expect(created.id).not.toBe("11111111-1111-4111-8111-111111111111");
  });

  test("a userId in the request body is ignored on update", async () => {
    const bobCollection = await createCollection({ owner: bob });

    const res = await request(app)
      .put(`/api/collections/${bobCollection.id}`)
      .set(bob.headers)
      .send({ collection: { name: "Renamed", userId: alice.id } });

    expect(res.status).toBe(200);

    await bobCollection.reload();
    expect(bobCollection.name).toBe("Renamed");
    expect(bobCollection.userId).toBe(bob.id);
  });

  test("responses never carry userId, email or password", async () => {
    await request(app)
      .post(`/api/collections/${aliceCollection.id}/articles`)
      .set(alice.headers)
      .send({ article: { slug: (await createArticle({ author: bob })).slug } });

    const list = await request(app).get("/api/collections").set(alice.headers);
    const detail = await request(app)
      .get(`/api/collections/${aliceCollection.id}`)
      .set(alice.headers);
    const articles = await request(app)
      .get(`/api/collections/${aliceCollection.id}/articles`)
      .set(alice.headers);

    for (const res of [list, detail, articles]) {
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/"userId"/);
      expect(body).not.toMatch(/"email"/);
      expect(body).not.toMatch(/"password"/);
      expect(body).not.toMatch(/"token"/);
    }

    //? Article bodies are left out of the list response too.
    expect(JSON.stringify(articles.body)).not.toMatch(/"body"/);
  });
});
