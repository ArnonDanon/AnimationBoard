import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // The single source of truth for the app version is this package.json's own
    // "version" field (semver) -- baked in at build time so the running app can
    // display exactly what was deployed, without a runtime fetch.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
