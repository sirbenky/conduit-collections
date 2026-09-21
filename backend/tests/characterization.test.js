const request = require("supertest");
const app = require("../app");
const { createArticle, createUser, DEFAULT_PASSWORD } = require("./factories");

//? These tests describe how the app behaved before the Collections work
//? started. They exist to catch a regression in existing behaviour, not to
//? endorse it - where the behaviour is odd, the test says so.
describe("Existing API (characterization)", () => {
  describe("registration and login", () => {
    test("registers a user and returns a token", async () => {
      const res = await request(app)
        .post("/api/users")
        .send({
          user: {
            username: "charUser1",
            email: "charUser1@example.test",
            password: "a-password",
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.user.username).toBe("charUser1");
      expect(res.body.user.token).toEqual(expect.any(String));
      expect(res.body.user.password).toBeUndefined();
      expect(res.body.user.id).toBeUndefined();
    });

    test("rejects a duplicate email with 422", async () => {
      const { email } = await createUser();

      const res = await request(app)
        .post("/api/users")
        .send({ user: { username: "someoneElse", email, password: "pw" } });

      expect(res.status).toBe(422);
    });

    test("logs in with the right password and rejects the wrong one", async () => {
      const { email } = await createUser();

      const ok = await request(app)
        .post("/api/users/login")
        .send({ user: { email, password: DEFAULT_PASSWORD } });
      expect(ok.status).toBe(200);
      expect(ok.body.user.token).toEqual(expect.any(String));

      const bad = await request(app)
        .post("/api/users/login")
        .send({ user: { email, password: "wrong" } });
      expect(bad.status).toBe(422);
    });
  });

  describe("current user", () => {
    test("returns the logged user", async () => {
      const { headers, username } = await createUser();

      const res = await request(app).get("/api/user").set(headers);

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe(username);
    });
  });

  describe("articles", () => {
    test("creates an article and reads it back by slug", async () => {
      const { headers, username } = await createUser();

      const created = await request(app)
        .post("/api/articles")
        .set(headers)
        .send({
          article: {
            title: "Characterization Article",
            description: "desc",
            body: "body",
            tagList: ["dragons", "training"],
          },
        });

      expect(created.status).toBe(201);
      expect(created.body.article.slug).toBe("characterization-article");

      const fetched = await request(app).get(
        "/api/articles/characterization-article",
      );

      expect(fetched.status).toBe(200);
      expect(fetched.body.article.title).toBe("Characterization Article");
      expect(fetched.body.article.author.username).toBe(username);
      expect(fetched.body.article.tagList.sort()).toEqual([
        "dragons",
        "training",
      ]);
    });

    test("lists articles with a count", async () => {
      const { user } = await createUser();
      await createArticle({ author: user });
      await createArticle({ author: user });

      const res = await request(app).get("/api/articles?limit=10");

      expect(res.status).toBe(200);
      expect(res.body.articlesCount).toBe(2);
      expect(res.body.articles).toHaveLength(2);
    });

    test("offset counts pages, not rows, on the existing list endpoint", async () => {
      //? Deliberately pinned: /api/articles computes `offset * limit`, so
      //? offset=1&limit=2 skips two rows, not one. The current frontend
      //? depends on it. The new collection endpoints count rows instead, and
      //? the README calls out the difference.
      const { user } = await createUser();
      await createArticle({ author: user, title: "Page A" });
      await createArticle({ author: user, title: "Page B" });
      await createArticle({ author: user, title: "Page C" });

      const page2 = await request(app).get("/api/articles?limit=2&offset=1");

      expect(page2.status).toBe(200);
      expect(page2.body.articles).toHaveLength(1);
    });

    test("404s an unknown slug", async () => {
      const res = await request(app).get("/api/articles/no-such-article");

      expect(res.status).toBe(404);
    });

    test("refuses to let a non-author update an article", async () => {
      const { user } = await createUser();
      const article = await createArticle({ author: user });
      const other = await createUser();

      const res = await request(app)
        .put(`/api/articles/${article.slug}`)
        .set(other.headers)
        .send({ article: { title: "Hijacked" } });

      expect(res.status).toBe(403);
    });
  });

  describe("favorites", () => {
    test("favorites and unfavorites an article", async () => {
      const { user } = await createUser();
      const article = await createArticle({ author: user });
      const reader = await createUser();

      const faved = await request(app)
        .post(`/api/articles/${article.slug}/favorite`)
        .set(reader.headers);

      expect(faved.status).toBe(200);
      expect(faved.body.article.favorited).toBe(true);
      expect(faved.body.article.favoritesCount).toBe(1);

      const unfaved = await request(app)
        .delete(`/api/articles/${article.slug}/favorite`)
        .set(reader.headers);

      expect(unfaved.status).toBe(200);
      expect(unfaved.body.article.favorited).toBe(false);
      expect(unfaved.body.article.favoritesCount).toBe(0);
    });
  });

  describe("comments", () => {
    test("adds, lists and deletes a comment", async () => {
      const { user, headers } = await createUser();
      const article = await createArticle({ author: user });

      const created = await request(app)
        .post(`/api/articles/${article.slug}/comments`)
        .set(headers)
        .send({ comment: { body: "Nice one" } });

      expect(created.status).toBe(201);
      const commentId = created.body.comment.id;

      const listed = await request(app).get(
        `/api/articles/${article.slug}/comments`,
      );
      expect(listed.status).toBe(200);
      expect(listed.body.comments).toHaveLength(1);

      const deleted = await request(app)
        .delete(`/api/articles/${article.slug}/comments/${commentId}`)
        .set(headers);
      expect(deleted.status).toBe(200);
    });
  });

  describe("profiles and follows", () => {
    test("follows and unfollows a profile", async () => {
      const target = await createUser();
      const follower = await createUser();

      const followed = await request(app)
        .post(`/api/profiles/${target.username}/follow`)
        .set(follower.headers);

      expect(followed.status).toBe(200);
      expect(followed.body.profile.following).toBe(true);
      expect(followed.body.profile.followersCount).toBe(1);

      const unfollowed = await request(app)
        .delete(`/api/profiles/${target.username}/follow`)
        .set(follower.headers);

      expect(unfollowed.status).toBe(200);
      expect(unfollowed.body.profile.following).toBe(false);
    });
  });

  describe("tags", () => {
    test("lists tags used by articles", async () => {
      const { user } = await createUser();
      await createArticle({ author: user, tags: ["welding"] });

      const res = await request(app).get("/api/tags");

      expect(res.status).toBe(200);
      expect(res.body.tags).toContain("welding");
    });
  });
});
