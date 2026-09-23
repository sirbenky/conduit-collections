import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

// Two projects because the halves need different environments: the backend
// runs in node against a real Postgres, the frontend in jsdom.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "backend",
          globals: true,
          environment: "node",
          include: ["backend/**/*.test.js"],
          globalSetup: ["backend/tests/globalSetup.js"],
          setupFiles: ["backend/tests/setupTests.js"],
          // One shared database, so files run one at a time.
          fileParallelism: false,
          testTimeout: 20000,
          hookTimeout: 60000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: "frontend",
          globals: true,
          environment: "jsdom",
          include: ["frontend/src/**/*.test.{js,jsx}"],
          setupFiles: ["frontend/src/setupTests.js"],
          css: true,
        },
      },
    ],
  },
});
