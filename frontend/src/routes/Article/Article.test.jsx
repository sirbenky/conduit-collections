import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HttpResponse, http } from "msw";
import Article from "./Article";
import { AuthContext } from "../../context/AuthContext";
import { server } from "../../tests/server";
import { article, signedIn } from "../../tests/helpers";

//? Article reads its initial state from router state, which ArticlesPreview
//? passes when a row is clicked. The collection endpoint leaves the body out
//? on purpose, so without the guard fix an article opened from a collection
//? renders a page with no content and never fetches.
function renderArticle({ state }) {
  return render(
    <AuthContext.Provider value={signedIn}>
      <MemoryRouter
        initialEntries={[{ pathname: "/article/an-article", state }]}
      >
        <Routes>
          <Route path="/article/:slug" element={<Article />} />
          <Route path="/not-found" element={<p>Not found page</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("Article page", () => {
  test("fetches when the router state has no body", async () => {
    let fetched = false;
    server.use(
      http.get("*/api/articles/an-article", () => {
        fetched = true;
        return HttpResponse.json({
          article: article({ title: "An article", body: "The real body" }),
        });
      }),
    );

    //? Exactly the shape a collection row passes: everything but the body.
    renderArticle({ state: article({ title: "An article" }) });

    await waitFor(() => expect(fetched).toBe(true));
    expect(await screen.findByText("The real body")).toBeInTheDocument();
  });

  test("does not fetch when the router state already has a body", async () => {
    let fetched = false;
    server.use(
      http.get("*/api/articles/an-article", () => {
        fetched = true;
        return HttpResponse.json({ article: article({ body: "From server" }) });
      }),
    );

    renderArticle({
      state: article({ title: "An article", body: "From router state" }),
    });

    expect(await screen.findByText("From router state")).toBeInTheDocument();
    expect(fetched).toBe(false);
  });

  test("fetches when there is no router state at all", async () => {
    let fetched = false;
    server.use(
      http.get("*/api/articles/an-article", () => {
        fetched = true;
        return HttpResponse.json({
          article: article({ body: "Fetched body" }),
        });
      }),
    );

    renderArticle({ state: null });

    await waitFor(() => expect(fetched).toBe(true));
    expect(await screen.findByText("Fetched body")).toBeInTheDocument();
  });
});
