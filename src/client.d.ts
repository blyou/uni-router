declare function definePage<Q extends import('./runtime.mjs').QuerySchema = Record<never, never>>(
  options: import('./runtime.mjs').PageDefinition<Q>,
): import('./runtime.mjs').PageQuery<Q>

declare module '@blyou/uni-router/auto-routes' {
  export const routes: readonly import('./runtime.mjs').RouteRecord[]
}
