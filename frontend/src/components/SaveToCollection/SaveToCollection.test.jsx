import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import SaveToCollection from "./SaveToCollection";
import { server } from "../../tests/server";
import {
  collection,
  errorBody,
  renderWithProviders,
  signedOut,
} from "../../tests/helpers";

const pickerCollections = (collections) =>
  http.get("*/api/collections", () => HttpResponse.json({ collections }));

const openPicker = async () =>
  userEvent.click(screen.getByRole("button", { name: /save/i }));

describe("Save to collection", () => {
  test("is hidden from guests", () => {
    renderWithProviders(<SaveToCollection slug="an-article" />, {
      auth: signedOut,
    });

    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  test("loads membership only once opened", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/collections", () => {
        calls += 1;
        return HttpResponse.json({ collections: [] });
      }),
    );

    renderWithProviders(<SaveToCollection slug="an-article" />);

    expect(calls).toBe(0);

    await openPicker();

    await waitFor(() => expect(calls).toBe(1));
  });

  test("re-reads membership every time it opens", async () => {
    //? ArticlesButtons renders twice on an article page, so a copy held in
    //? either instance would go stale as soon as the other was used.
    let calls = 0;
    server.use(
      http.get("*/api/collections", () => {
        calls += 1;
        return HttpResponse.json({ collections: [collection()] });
      }),
    );

    renderWithProviders(<SaveToCollection slug="an-article" />);

    await openPicker();
    await screen.findByText("Reading list");
    await openPicker();
    await openPicker();

    await waitFor(() => expect(calls).toBe(2));
  });

  test("shows a checkmark straight away, before the server answers", async () => {
    server.use(
      pickerCollections([collection({ hasArticle: false })]),
      http.post("*/api/collections/:id/articles", async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return HttpResponse.json({ collection: collection() }, { status: 201 });
      }),
    );

    renderWithProviders(<SaveToCollection slug="an-article" />);

    await openPicker();
    const row = await screen.findByRole("button", { name: /reading list/i });
    expect(row).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(row);

    //? Optimistic: pressed before the POST has come back.
    expect(row).toHaveAttribute("aria-pressed", "true");
  });

  test("rolls the checkmark back when the save fails", async () => {
    server.use(
      pickerCollections([collection({ hasArticle: false, articlesCount: 2 })]),
      http.post("*/api/collections/:id/articles", () =>
        HttpResponse.json(errorBody("Nope"), { status: 500 }),
      ),
    );

    renderWithProviders(<SaveToCollection slug="an-article" />);

    await openPicker();
    const row = await screen.findByRole("button", { name: /reading list/i });

    await userEvent.click(row);

    await waitFor(() =>
      expect(row).toHaveAttribute("aria-pressed", "false"),
    );
    expect(await screen.findByText("Nope")).toBeInTheDocument();
    //? The count goes back too, not just the tick.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  test("treats a 409 on save as already saved", async () => {
    //? A double click, or the same article saved in another tab. The server
    //? is in the state the user asked for, so this is not an error.
    server.use(
      pickerCollections([collection({ hasArticle: false })]),
      http.post("*/api/collections/:id/articles", () =>
        HttpResponse.json(errorBody("That article is already in this collection."), {
          status: 409,
        }),
      ),
    );

    renderWithProviders(<SaveToCollection slug="an-article" />);

    await openPicker();
    const row = await screen.findByRole("button", { name: /reading list/i });

    await userEvent.click(row);

    await waitFor(() => expect(row).toHaveAttribute("aria-pressed", "true"));
    expect(
      screen.queryByText("That article is already in this collection."),
    ).toBeNull();
  });

  test("treats a 404 on remove as already removed", async () => {
    server.use(
      pickerCollections([collection({ hasArticle: true, articlesCount: 1 })]),
      http.delete("*/api/collections/:id/articles/:slug", () =>
        HttpResponse.json(errorBody("Article not found in this collection"), {
          status: 404,
        }),
      ),
    );

    renderWithProviders(<SaveToCollection slug="an-article" />);

    await openPicker();
    const row = await screen.findByRole("button", { name: /reading list/i });

    await userEvent.click(row);

    await waitFor(() => expect(row).toHaveAttribute("aria-pressed", "false"));
  });

  test("the button reads Saved once something has been saved", async () => {
    server.use(
      pickerCollections([collection({ hasArticle: false })]),
      http.post(
        "*/api/collections/:id/articles",
        () => HttpResponse.json({ collection: collection() }, { status: 201 }),
      ),
    );

    renderWithProviders(<SaveToCollection slug="an-article" />);

    await openPicker();
    await userEvent.click(
      await screen.findByRole("button", { name: /reading list/i }),
    );

    expect(
      await screen.findByRole("button", { name: /saved/i }),
    ).toBeInTheDocument();
  });

  test("offers to create a collection when there are none", async () => {
    server.use(pickerCollections([]));

    renderWithProviders(<SaveToCollection slug="an-article" />);

    await openPicker();

    expect(
      await screen.findByText("You don't have any collections yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new collection/i }),
    ).toBeInTheDocument();
  });

  test("creates a collection and saves into it in one step", async () => {
    let posted = null;
    server.use(
      pickerCollections([]),
      http.post("*/api/collections", async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          { collection: collection({ name: "Fresh" }) },
          { status: 201 },
        );
      }),
      http.post(
        "*/api/collections/:id/articles",
        () => HttpResponse.json({ collection: collection() }, { status: 201 }),
      ),
    );

    renderWithProviders(<SaveToCollection slug="an-article" />);

    await openPicker();
    await userEvent.click(
      await screen.findByRole("button", { name: /new collection/i }),
    );
    await userEvent.type(
      screen.getByLabelText("New collection name"),
      "Fresh",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /create and save/i }),
    );

    await waitFor(() => expect(posted?.collection?.name).toBe("Fresh"));
  });

  test("shows a retry when the collections cannot be loaded", async () => {
    server.use(
      http.get("*/api/collections", () =>
        HttpResponse.json(errorBody("Boom"), { status: 500 }),
      ),
    );

    renderWithProviders(<SaveToCollection slug="an-article" />);

    await openPicker();

    expect(
      await screen.findByText("Couldn't load your collections."),
    ).toBeInTheDocument();
  });

  test("closes on Escape and gives focus back to the button", async () => {
    server.use(pickerCollections([collection()]));

    renderWithProviders(<SaveToCollection slug="an-article" />);

    const button = screen.getByRole("button", { name: /save/i });
    await userEvent.click(button);
    await screen.findByText("Reading list");

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByText("Reading list")).toBeNull());
    expect(button).toHaveFocus();
  });
});
