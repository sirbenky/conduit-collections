import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

export const signedIn = {
  headers: { Authorization: "Token test-token" },
  isAuth: true,
  loggedUser: { username: "tester", bio: null, image: null, email: "" },
  setAuthState: () => {},
};

export const signedOut = {
  headers: null,
  isAuth: false,
  loggedUser: { username: "", bio: null, image: null, email: "" },
  setAuthState: () => {},
};

//? AuthProvider reads localStorage when the module loads, which a test
//? cannot get in front of, so tests supply the context value directly.
export function renderWithProviders(
  ui,
  { auth = signedIn, path = "/", route = "/" } = {},
) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
          <Route path="/login" element={<p>Login page</p>} />
          <Route path="*" element={<p>Somewhere else</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

export const collection = (overrides = {}) => ({
  id: "3f3ec2b8-1f9a-4a1e-93a3-2b52f7d7c2aa",
  name: "Reading list",
  description: null,
  articlesCount: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

export const article = (overrides = {}) => ({
  slug: "an-article",
  title: "An article",
  description: "A description",
  createdAt: "2026-09-01T00:00:00.000Z",
  tagList: [],
  favorited: false,
  favoritesCount: 0,
  author: {
    username: "author",
    bio: null,
    image: null,
    following: false,
    followersCount: 0,
  },
  ...overrides,
});

export const errorBody = (message) => ({ errors: { body: [message] } });
