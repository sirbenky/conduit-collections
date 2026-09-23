import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Fail if 3000 is taken instead of sliding onto the next free port.
    // The next port is 3001, which is the backend's, so the fallback made
    // the dev server proxy /api to itself: every request looped back in and
    // the process ran out of sockets (ENOBUFS) instead of saying what was
    // wrong. Failing fast names the actual problem.
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001'
      }
    }
  },
  // `vite preview` does not inherit server.proxy, and the end-to-end tests
  // run against the built app rather than the dev server, so the same proxy
  // has to be declared for preview too.
  preview: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001'
      }
    }
  }
})
