import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/runtime.ts'],
  deps: {
    neverBundle: ['@blyou/uni-router/auto-routes'],
  },
  dts: {
    tsgo: true,
  },
  exports: false,
  copy: ['src/client.d.ts'],
  format: ['esm', 'cjs'],
})
