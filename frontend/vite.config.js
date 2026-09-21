import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
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
    proxy: {
      '/api': {
        target: 'http://localhost:3001'
      }
    }
  }
})
