import { expect, test } from "@playwright/test";

const API = "http://localhost:3001/api";

//? Unique per run, so the suite can be run repeatedly against a database
//? that already has data in it without colliding on the unique indexes.
const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

//? The app uses HashRouter, so every route lives behind a #.
const route = (path) => `/#${path}`;

async function seedUserAndArticle(request) {
  const id = unique();
  const user = {
    username: `e2e${id}`,
    email: `e2e${id}@example.test`,
    password: "e2e-password",
  };

  const registered = await request.post(`${API}/users`, { data: { user } });
  expect(registered.ok()).toBeTruthy();
  const { user: created } = await registered.json();

  const article = {
    title: `End to end article ${id}`,
    description: "Saved during the end-to-end run",
    body: "The body of the end-to-end article.",
    tagList: ["e2e"],
  };

  const published = await request.post(`${API}/articles`, {
    data: { article },
    headers: { Authorization: `Token ${created.token}` },
  });
  expect(published.ok()).toBeTruthy();
  const { article: publishedArticle } = await published.json();

  return { user, article: publishedArticle, id };
}

test("login, create a collection, save an article, see it, remove it", async ({
  page,
  request,
}) => {
  const { user, article, id } = await seedUserAndArticle(request);
  const collectionName = `E2E list ${id}`;

  // 1. Log in through the UI.
  await page.goto(route("/login"));
  await page.getByPlaceholder("Email").fill(user.email);
  await page.getByPlaceholder("Password").fill(user.password);
  await page.getByRole("button", { name: "Login" }).click();

  await expect(
    page.getByRole("link", { name: "My Collections" }),
  ).toBeVisible();

  // 2. Create a collection.
  await page.getByRole("link", { name: "My Collections" }).click();
  await expect(
    page.getByRole("heading", { name: "My Collections" }),
  ).toBeVisible();
  await expect(
    page.getByText("You don't have any collections yet."),
  ).toBeVisible();

  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByPlaceholder("Collection name").fill(collectionName);
  await page.getByPlaceholder("Description (optional)").fill("Made by the E2E run");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByRole("heading", { name: collectionName })).toBeVisible();
  await expect(page.getByText("0 articles")).toBeVisible();

  // 3. Save the article from its own page.
  await page.goto(route(`/article/${article.slug}`));
  await expect(
    page.getByRole("heading", { name: article.title }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await page.getByRole("button", { name: new RegExp(collectionName) }).click();

  //? The button label flipping to Saved is the app telling us the write
  //? came back, so there is no fixed wait anywhere in this test.
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }).first(),
  ).toBeVisible();

  // 4. Open the collection and find the article in it.
  await page.goto(route("/collections"));
  await expect(page.getByText("1 article", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: collectionName }).click();
  await expect(
    page.getByRole("heading", { name: collectionName }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: article.title })).toBeVisible();

  // 5. Remove it and land on the empty state.
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(
    page.getByText("Nothing saved here yet. Open an article and use Save to add it."),
  ).toBeVisible();

  //? The article itself is untouched by removing it from a collection.
  await page.goto(route(`/article/${article.slug}`));
  await expect(
    page.getByRole("heading", { name: article.title }),
  ).toBeVisible();
  await expect(page.getByText("The body of the end-to-end article.")).toBeVisible();
});

test("another user cannot reach the collection by its id", async ({
  page,
  request,
}) => {
  const owner = await seedUserAndArticle(request);
  const intruder = await seedUserAndArticle(request);

  //? Create the collection through the API so the test is about the access
  //? boundary rather than about the form.
  const login = await request.post(`${API}/users/login`, {
    data: { user: { email: owner.user.email, password: owner.user.password } },
  });
  const { user: signedIn } = await login.json();

  const created = await request.post(`${API}/collections`, {
    data: { collection: { name: `Private ${owner.id}` } },
    headers: { Authorization: `Token ${signedIn.token}` },
  });
  const { collection } = await created.json();

  // Sign in as somebody else and try the owner's collection URL directly.
  await page.goto(route("/login"));
  await page.getByPlaceholder("Email").fill(intruder.user.email);
  await page.getByPlaceholder("Password").fill(intruder.user.password);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(
    page.getByRole("link", { name: "My Collections" }),
  ).toBeVisible();

  await page.goto(route(`/collections/${collection.id}`));

  await expect(page.getByText("Collection not found")).toBeVisible();
  await expect(page.getByText(`Private ${owner.id}`)).toHaveCount(0);
});
