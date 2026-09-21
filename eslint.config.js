import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

//? The project had no linter. This is a deliberately small config: the
//? recommended rule sets plus the react-hooks rules, which are the ones that
//? catch real bugs in this codebase (a missing dependency in an effect is
//? how stale data gets on screen). It is not a style rewrite of existing
//? code - no formatting opinions are enforced here.
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  {
    // Backend: CommonJS running in node.
    files: ["backend/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      //? sequelize-cli hands every migration and seeder (queryInterface,
      //? Sequelize), and Express only treats a handler as error middleware
      //? if it declares four arguments. Both mean an unused argument is
      //? required by the signature, not a mistake.
      "no-unused-vars": ["error", { args: "none" }],
    },
  },
  {
    // Backend tests additionally get the vitest globals.
    files: ["backend/**/*.test.js", "backend/tests/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
  {
    // Frontend: ES modules running in the browser.
    files: ["frontend/**/*.{js,jsx}"],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      ...react.configs.flat.recommended.plugins,
      "react-hooks": reactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      //? This codebase does not use prop-types and is not typed. Turning the
      //? rule on would mean annotating every existing component, which is
      //? exactly the unrelated churn the brief warns against.
      "react/prop-types": "off",
      //? React 19 with the automatic JSX runtime needs no React import.
      "react/react-in-jsx-scope": "off",
      //? Warn, not error. This fires on the data-loading pattern the
      //? codebase already uses in useArticles, PopularTags and FeedContext:
      //? set a loading flag, fetch, clear it. The new hooks follow the same
      //? shape on purpose. Making it an error would mean re-architecting
      //? existing screens, which is the unrelated churn the brief warns
      //? against - so it stays visible without failing the build.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    files: ["frontend/**/*.test.{js,jsx}", "frontend/src/tests/**/*.{js,jsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.vitest },
    },
  },
  {
    // Playwright specs and the root tooling config files.
    files: ["e2e/**/*.js", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
