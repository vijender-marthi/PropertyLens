import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // host: true binds to 0.0.0.0 so other devices on your LAN (e.g. an iPad on
    // the same Wi-Fi) can reach the dev server at http://<this-mac-ip>:5177.
    // Still private to your local network — not exposed to the internet.
    host: true,
    port: 5177,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
