import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import CollectionDetail from "./CollectionDetail";
import { server } from "../../tests/server";
import {
  article,
  collection,
  errorBody,
  renderWithProviders,
  signedOut,
} from "../../tests/helpers";

const ID = "3f3ec2b8-1f9a-4a1e-93a3-2b52f7d7c2aa";

const renderDetail = () =>
  renderWithProviders(<CollectionDetail />, {
    path: "/collections/:id",
    route: `/collections/${ID}`,
  });

const detailHandlers = ({ articles, articlesCount }) => [
  http.get(`*/api/collections/${ID}`, () =>
    HttpResponse.json({ collection: collection({ articlesCount }) }),
  ),
  http.get(`*/api/collections/${ID}/articles`, () =>
    HttpResponse.json({ articles, articlesCount }),
  ),
];

const pageOf = (count, offset = 0, limit = 10) =>
  Array.from({ length: Math.min(limit, count - offset) }, (_, index) =>
    article({
      slug: `article-${offset + index + 1}`,
      title: `Article ${offset + index + 1}`,
    }),
  );

describe("Collection detail", () => {
  test("guests are redirected to login", async () => {
    renderWithProviders(<CollectionDetail />, {
      auth: signedOut,
      path: "/collections/:id",
      route: `/collections/${ID}`,
    });

    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  test("shows the collection name and its saved articles", async () => {
    server.use(
      ...detailHandlers({ articles: [article({ title: "Saved one" })], articlesCount: 1 }),
    );

    renderDetail();

    expect(await screen.findByText("Reading list")).toBeInTheDocument();
    expect(await screen.findByText("Saved one")).toBeInTheDocument();
  });

  test("shows the empty state that says how to fill it", async () => {
    server.use(...detailHandlers({ articles: [], articlesCount: 0 }));

    renderDetail();

    expect(
      await screen.findByText(
        "Nothing saved here yet. Open an article and use Save to add it.",
      ),
    ).toBeInTheDocument();
  });

  test("shows an error state rather than an empty collection", async () => {
    server.use(
      http.get(`*/api/collections/${ID}`, () =>
        HttpResponse.json({ collection: collection() }),
      ),
      http.get(`*/api/collections/${ID}/articles`, () =>
        HttpResponse.json(errorBody("Boom"), { status: 500 }),
      ),
    );

    renderDetail();

    expect(
      await screen.findByText("Couldn't load this collection."),
    ).toBeInTheDocument();
  });

  test("removes an article and refreshes the list", async () => {
    let removed = null;
    let listCalls = 0;

    server.use(
      http.get(`*/api/collections/${ID}`, () =>
        HttpResponse.json({ collection: collection({ articlesCount: 1 }) }),
      ),
      http.get(`*/api/collections/${ID}/articles`, () => {
        listCalls += 1;
        return listCalls === 1
          ? HttpResponse.json({
              articles: [article({ title: "Goes away" })],
              articlesCount: 1,
            })
          : HttpResponse.json({ articles: [], articlesCount: 0 });
      }),
      http.delete(`*/api/collections/${ID}/articles/:slug`, ({ params }) => {
        removed = params.slug;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderDetail();

    await userEvent.click(
      await screen.findByRole("button", { name: "Remove" }),
    );

    await waitFor(() => expect(removed).toBe("an-article"));
    expect(
      await screen.findByText(
        "Nothing saved here yet. Open an article and use Save to add it.",
      ),
    ).toBeInTheDocument();
  });

  test("steps back a page after removing the last article on it", async () => {
    //? 11 articles is two pages. Remove the only article on page two and the
    //? pager has to fall back to page one, or it points at a page that no
    //? longer exists and the screen looks empty.
    let total = 11;
    const offsets = [];

    server.use(
      http.get(`*/api/collections/${ID}`, () =>
        HttpResponse.json({ collection: collection({ articlesCount: total }) }),
      ),
      http.get(`*/api/collections/${ID}/articles`, ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get("offset"));
        offsets.push(offset);
        return HttpResponse.json({
          articles: pageOf(total, offset),
          articlesCount: total,
        });
      }),
      http.delete(`*/api/collections/${ID}/articles/:slug`, () => {
        total -= 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderDetail();

    await screen.findByText("Article 1");

    //? react-paginate renders page links as role="button" with an
    //? aria-label of "Page N", not as anchors.
    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    await screen.findByText("Article 11");
    expect(offsets).toContain(10);

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    //? Back on page one, and the last request asked for offset 0.
    await waitFor(() => expect(offsets.at(-1)).toBe(0));
    expect(await screen.findByText("Article 1")).toBeInTheDocument();
  });

  test("does not show a pager when everything fits on one page", async () => {
    server.use(
      ...detailHandlers({ articles: pageOf(3), articlesCount: 3 }),
    );

    renderDetail();

    await screen.findByText("Article 1");

    expect(screen.queryByRole("button", { name: "Page 2" })).toBeNull();
  });
});
