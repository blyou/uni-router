import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@blyou/uni-router/auto-routes': fileURLToPath(new URL('./tests/auto-routes.ts', import.meta.url)),
    },
  },
})
