import type { RouteRecord } from './runtime'

// Fallback for tooling that resolves package exports without the Vite plugin.
// During a real build the plugin replaces this module with the generated manifest.
export const routes: readonly RouteRecord[] = Object.freeze([])
