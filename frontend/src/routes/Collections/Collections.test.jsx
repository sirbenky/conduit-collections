import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import Collections from "./Collections";
import { server } from "../../tests/server";
import {
  collection,
  errorBody,
  renderWithProviders,
  signedOut,
} from "../../tests/helpers";

const listReturns = (collections) =>
  http.get("*/api/collections", () => HttpResponse.json({ collections }));

describe("My Collections", () => {
  describe("list states", () => {
    test("shows a loading state first", async () => {
      server.use(
        http.get("*/api/collections", async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return HttpResponse.json({ collections: [] });
        }),
      );

      renderWithProviders(<Collections />);

      expect(screen.getByText("Loading collections...")).toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.queryByText("Loading collections..."),
        ).not.toBeInTheDocument(),
      );
    });

    test("shows the empty state with a way out of it", async () => {
      server.use(listReturns([]));

      renderWithProviders(<Collections />);

      expect(
        await screen.findByText("You don't have any collections yet."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /new collection/i }),
      ).toBeInTheDocument();
    });

    test("shows an error state with a retry, not an empty list", async () => {
      //? The important half of this: a failed load must not look the same as
      //? "you have no collections".
      server.use(
        http.get("*/api/collections", () =>
          HttpResponse.json(errorBody("Nope"), { status: 500 }),
        ),
      );

      renderWithProviders(<Collections />);

      expect(
        await screen.findByText("Couldn't load your collections."),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("You don't have any collections yet."),
      ).not.toBeInTheDocument();

      let attempts = 0;
      server.use(
        http.get("*/api/collections", () => {
          attempts += 1;
          return HttpResponse.json({ collections: [collection()] });
        }),
      );

      await userEvent.click(screen.getByRole("button", { name: /try again/i }));

      expect(await screen.findByText("Reading list")).toBeInTheDocument();
      expect(attempts).toBe(1);
    });

    test("lists collections with their article counts", async () => {
      server.use(
        listReturns([
          collection({ name: "Reading list", articlesCount: 3 }),
          collection({
            id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
            name: "Solo",
            articlesCount: 1,
          }),
        ]),
      );

      renderWithProviders(<Collections />);

      expect(await screen.findByText("Reading list")).toBeInTheDocument();
      expect(screen.getByText("3 articles")).toBeInTheDocument();
      expect(screen.getByText("1 article")).toBeInTheDocument();
    });
  });

  describe("creating", () => {
    test("shows a backend 409 inline instead of a blank failure", async () => {
      server.use(
        listReturns([]),
        http.post("*/api/collections", () =>
          HttpResponse.json(
            errorBody("A collection with that name already exists."),
            { status: 409 },
          ),
        ),
      );

      renderWithProviders(<Collections />);

      await userEvent.click(
        await screen.findByRole("button", { name: /new collection/i }),
      );
      await userEvent.type(
        screen.getByPlaceholderText("Collection name"),
        "Reading list",
      );
      await userEvent.click(screen.getByRole("button", { name: "Create" }));

      expect(
        await screen.findByText("A collection with that name already exists."),
      ).toBeInTheDocument();
    });

    test("a double-clicked submit sends one request", async () => {
      //? Submit is disabled while the request is in flight, so an impatient
      //? double click cannot create two collections.
      let posts = 0;
      server.use(
        listReturns([]),
        http.post("*/api/collections", async () => {
          posts += 1;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return HttpResponse.json(
            { collection: collection({ name: "New one" }) },
            { status: 201 },
          );
        }),
      );

      renderWithProviders(<Collections />);

      await userEvent.click(
        await screen.findByRole("button", { name: /new collection/i }),
      );
      await userEvent.type(
        screen.getByPlaceholderText("Collection name"),
        "New one",
      );

      const submit = screen.getByRole("button", { name: "Create" });
      await userEvent.dblClick(submit);

      await waitFor(() => expect(posts).toBe(1));
    });

    test("submit is disabled until a name is typed", async () => {
      server.use(listReturns([]));

      renderWithProviders(<Collections />);

      await userEvent.click(
        await screen.findByRole("button", { name: /new collection/i }),
      );

      expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();

      await userEvent.type(
        screen.getByPlaceholderText("Collection name"),
        "Something",
      );

      expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
    });
  });

  describe("deleting", () => {
    test("asks for confirmation inline and says the articles are safe", async () => {
      server.use(listReturns([collection()]));

      renderWithProviders(<Collections />);

      await userEvent.click(
        await screen.findByRole("button", { name: /delete collection/i }),
      );

      expect(
        screen.getByText(
          "Delete this collection? The articles stay where they are.",
        ),
      ).toBeInTheDocument();
    });

    test("cancelling does not send a delete", async () => {
      let deletes = 0;
      server.use(
        listReturns([collection()]),
        http.delete("*/api/collections/:id", () => {
          deletes += 1;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      renderWithProviders(<Collections />);

      await userEvent.click(
        await screen.findByRole("button", { name: /delete collection/i }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(deletes).toBe(0);
      expect(
        screen.queryByText(
          "Delete this collection? The articles stay where they are.",
        ),
      ).not.toBeInTheDocument();
    });

    test("confirming deletes and refreshes the list", async () => {
      let listCalls = 0;
      server.use(
        http.get("*/api/collections", () => {
          listCalls += 1;
          return HttpResponse.json({
            collections: listCalls === 1 ? [collection()] : [],
          });
        }),
        http.delete(
          "*/api/collections/:id",
          () => new HttpResponse(null, { status: 204 }),
        ),
      );

      renderWithProviders(<Collections />);

      await userEvent.click(
        await screen.findByRole("button", { name: /delete collection/i }),
      );
      const confirm = screen.getByText(
        "Delete this collection? The articles stay where they are.",
      ).parentElement;
      await userEvent.click(
        within(confirm).getByRole("button", { name: "Delete" }),
      );

      expect(
        await screen.findByText("You don't have any collections yet."),
      ).toBeInTheDocument();
    });
  });

  describe("renaming", () => {
    test("prefills the form and saves the change", async () => {
      let put = null;
      server.use(
        listReturns([collection({ name: "Before", description: "Old" })]),
        http.put("*/api/collections/:id", async ({ request }) => {
          put = await request.json();
          return HttpResponse.json({
            collection: collection({ name: "After" }),
          });
        }),
      );

      renderWithProviders(<Collections />);

      await userEvent.click(
        await screen.findByRole("button", { name: /edit/i }),
      );

      const name = screen.getByPlaceholderText("Collection name");
      expect(name).toHaveValue("Before");

      await userEvent.clear(name);
      await userEvent.type(name, "After");
      await userEvent.click(
        screen.getByRole("button", { name: "Save changes" }),
      );

      await waitFor(() => expect(put?.collection?.name).toBe("After"));
    });
  });

  describe("guests", () => {
    test("are redirected to login", async () => {
      renderWithProviders(<Collections />, { auth: signedOut });

      expect(await screen.findByText("Login page")).toBeInTheDocument();
    });
  });
});
