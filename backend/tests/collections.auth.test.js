const request = require("supertest");
const app = require("../app");
const collectionsRouter = require("../routes/collections");
const { Collection, CollectionArticle } = require("../models");
const { createArticle, createCollection, createUser } = require("./factories");

//? Reads the route table out of the router itself rather than repeating it.
//? A route added to routes/collections.js without auth shows up here as a
//? failure, which is the point of putting the middleware on the router.
function routesOf(router) {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods).map((method) => ({
        method,
        path: layer.route.path,
      })),
    );
}

//? Fills :id and :slug with values that exist nowhere, so a route that did
//? let the request through would 404, not 401 - the two are easy to tell
//? apart, and only 401 passes.
const concretePath = (path) =>
  path
    .replace(":id", "3f3ec2b8-1f9a-4a1e-93a3-2b52f7d7c2aa")
    .replace(":slug", "no-such-article");

describe("Collections: authentication", () => {
  const routes = routesOf(collectionsRouter);

  test("the router exposes the eight expected routes", () => {
    expect(routes).toHaveLength(8);
  });

  test.each(routes)("$method $path is 401 with no token", async (route) => {
    const res = await request(app)[route.method](
      `/api/collections${concretePath(route.path)}`,
    );

    expect(res.status).toBe(401);
  });

  test.each(routes)(
    "$method $path is 401 with a malformed token",
    async (route) => {
      //? This used to be a 500: verifyToken threw a SyntaxError and the
      //? error handler had no branch for it.
      const res = await request(app)
        [route.method](`/api/collections${concretePath(route.path)}`)
        .set({ Authorization: "Token not-a-real-jwt" });

      expect(res.status).toBe(401);
    },
  );

  test.each(routes)(
    "$method $path is 401 when the Authorization header has no token",
    async (route) => {
      const res = await request(app)
        [route.method](`/api/collections${concretePath(route.path)}`)
        .set({ Authorization: "Token" });

      expect(res.status).toBe(401);
    },
  );

  test("a token signed for a deleted user is rejected once, not twice", async () => {
    const { user, headers } = await createUser();
    await user.destroy();

    const res = await request(app).get("/api/collections").set(headers);

    expect(res.status).toBe(401);
  });

  test("an unauthenticated request never reaches the database", async () => {
    const owner = await createUser();
    const collection = await createCollection({ owner });
    const article = await createArticle({ author: owner.user });
    await CollectionArticle.create({
      collectionId: collection.id,
      articleId: article.id,
    });

    await request(app).delete(`/api/collections/${collection.id}`).expect(401);
    await request(app)
      .delete(`/api/collections/${collection.id}/articles/${article.slug}`)
      .expect(401);

    expect(await Collection.count()).toBe(1);
    expect(await CollectionArticle.count()).toBe(1);
  });
});
