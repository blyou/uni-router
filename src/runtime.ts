/// <reference types="@dcloudio/types" />

import { routes } from '@blyou/uni-router/auto-routes'
import type {
  NormalizedQueryField,
  NormalizedQuerySchema,
  PageDefinition,
  PageQuery,
  QuerySchema,
  UniRouteInfo,
} from './types'

// This interface is augmented by the generated uni-router.d.ts.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UniRouteMap {}

export type RoutePath = Extract<keyof UniRouteMap, string>
export type RouteQuery<P extends RoutePath> = UniRouteMap[P]['query']
export type RouteMeta<P extends RoutePath> = UniRouteMap[P]['meta']
export type TabRoutePath = {
  [P in RoutePath]: UniRouteMap[P]['tab'] extends true ? P : never
}[RoutePath]

type RequiredQueryKeys<P extends RoutePath> = {
  [K in keyof RouteQuery<P>]-?: Record<never, never> extends Pick<RouteQuery<P>, K> ? never : K
}[keyof RouteQuery<P>]

export type QueryOptions<P extends RoutePath> = [RequiredQueryKeys<P>] extends [never]
  ? { query?: RouteQuery<P> }
  : { query: RouteQuery<P> }

export type NavigateToOptions<P extends RoutePath = RoutePath> = Omit<
  UniNamespace.NavigateToOptions,
  'url'
> & { url: P } & QueryOptions<P>
export type RedirectToOptions<P extends RoutePath = RoutePath> = Omit<
  UniNamespace.RedirectToOptions,
  'url'
> & { url: P } & QueryOptions<P>
export type ReLaunchOptions<P extends RoutePath = RoutePath> = Omit<
  UniNamespace.ReLaunchOptions,
  'url'
> & { url: P } & QueryOptions<P>
export type SwitchTabOptions<P extends TabRoutePath = TabRoutePath> = Omit<
  UniNamespace.SwitchTabOptions,
  'url'
> & { url: P }

export type RouteRecord<P extends RoutePath = RoutePath> = P extends RoutePath
  ? {
      path: P
      meta: RouteMeta<P>
      query: NormalizedQuerySchema
      tab: UniRouteMap[P]['tab']
      subPackage?: string
    }
  : never

type RuntimeNavigationOptions = Omit<UniNamespace.NavigateToOptions, 'url'> & {
  url: string
  query?: Record<string, unknown>
}

function error(path: string, message: string): never {
  throw new Error(`[uni-router] ${path}: ${message}`)
}

const routesByPath = new Map<string, UniRouteInfo>()
for (const route of routes as readonly UniRouteInfo[]) {
  if (routesByPath.has(route.path)) error(route.path, 'Duplicate runtime route')
  routesByPath.set(route.path, route)
}

function getRoute(path: string) {
  const route = routesByPath.get(path)
  if (!route) error(path, 'Route is not registered')
  return route
}

function queryValue(path: string, name: string, type: string, value: unknown) {
  if (type === 'string' && typeof value === 'string') return value
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (type === 'boolean' && typeof value === 'boolean') return String(value)
  if (type === 'object' && value !== null && typeof value === 'object') {
    let serialized: string | undefined
    try {
      serialized = JSON.stringify(value)
    } catch {
      return error(path, `Query parameter "${name}" must be JSON serializable`)
    }
    if (serialized === undefined) error(path, `Query parameter "${name}" must be JSON serializable`)
    return serialized
  }
  return error(path, `Query parameter "${name}" must be ${type}`)
}

function serializeQuery(route: UniRouteInfo, query: Record<string, unknown> = {}) {
  for (const name of Object.keys(query)) {
    if (!Object.hasOwn(route.query, name)) error(route.path, `Unknown query parameter "${name}"`)
  }
  const pairs: string[] = []
  for (const [name, field] of Object.entries(route.query)) {
    const value = Object.hasOwn(query, name) ? query[name] : undefined
    if (value == null) {
      if (field.required) error(route.path, `Missing required query parameter "${name}"`)
      continue
    }
    const serialized = queryValue(route.path, name, field.type, value)
    pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(serialized)}`)
  }
  return pairs.length ? `${route.path}?${pairs.join('&')}` : route.path
}

type QueryRoute = Pick<UniRouteInfo, 'path' | 'query'>

function decodeQueryValue(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseValue(route: QueryRoute, name: string, field: NormalizedQueryField, value: unknown) {
  if (typeof value !== 'string') error(route.path, `Raw query parameter "${name}" must be a string`)
  const decoded = decodeQueryValue(value)
  if (field.format) {
    const formatted = field.format(decoded)
    queryValue(route.path, name, field.type, formatted)
    return formatted
  }
  const type = field.type
  if (type === 'string') return decoded
  if (type === 'number') {
    if (!decoded.trim()) error(route.path, `Query parameter "${name}" must be a finite number`)
    const number = Number(decoded)
    if (!Number.isFinite(number))
      error(route.path, `Query parameter "${name}" must be a finite number`)
    return number
  }
  if (type === 'object') {
    let object: unknown
    try {
      object = JSON.parse(decoded)
    } catch {
      return error(route.path, `Query parameter "${name}" must be valid JSON`)
    }
    if (object === null || typeof object !== 'object') {
      error(route.path, `Query parameter "${name}" must be an object`)
    }
    return object
  }
  if (decoded === 'true') return true
  if (decoded === 'false') return false
  return error(route.path, `Query parameter "${name}" must be true or false`)
}

function parse(route: QueryRoute, query: Record<string, unknown>) {
  const result: Record<string, unknown> = {}
  for (const [name, field] of Object.entries(route.query)) {
    const value = Object.hasOwn(query, name) ? query[name] : undefined
    if (value == null) {
      if (field.required) error(route.path, `Missing required query parameter "${name}"`)
      continue
    }
    if (name === '__proto__') {
      error(route.path, 'Query parameter name "__proto__" is not supported')
    }
    result[name] = parseValue(route, name, field, value)
  }
  return result
}

function navigate(
  method: 'navigateTo' | 'redirectTo' | 'reLaunch',
  options: RuntimeNavigationOptions,
) {
  const route = getRoute(options.url)
  const { query, ...nativeOptions } = options
  const url = serializeQuery(route, query)
  if (method === 'navigateTo') uni.navigateTo({ ...nativeOptions, url })
  else if (method === 'redirectTo') uni.redirectTo({ ...nativeOptions, url })
  else uni.reLaunch({ ...nativeOptions, url })
}

export function navigateTo<P extends RoutePath>(options: NavigateToOptions<P>): void {
  navigate('navigateTo', options as RuntimeNavigationOptions)
}

export function redirectTo<P extends RoutePath>(options: RedirectToOptions<P>): void {
  navigate('redirectTo', options as RuntimeNavigationOptions)
}

export function reLaunch<P extends RoutePath>(options: ReLaunchOptions<P>): void {
  navigate('reLaunch', options as RuntimeNavigationOptions)
}

export function switchTab<P extends TabRoutePath>(options: SwitchTabOptions<P>): void {
  const route = getRoute(options.url)
  if (!route.tab) error(options.url, 'Route is not a tabBar page')
  if ('query' in options) error(options.url, 'switchTab does not support query parameters')
  uni.switchTab({ ...options, url: route.path })
}

export function parseQuery<P extends RoutePath>(
  path: P,
  query: Record<string, unknown> = {},
): RouteQuery<P> {
  return parse(getRoute(path), query) as RouteQuery<P>
}

type NormalizedQueryFieldToSchema<F extends NormalizedQueryField> = {
  type: F['type'] extends 'string'
    ? StringConstructor
    : F['type'] extends 'number'
      ? NumberConstructor
      : F['type'] extends 'boolean'
        ? BooleanConstructor
        : ObjectConstructor
  required: F['required']
}

type NormalizedQueryToSchema<S extends NormalizedQuerySchema> = {
  [K in keyof S]: NormalizedQueryFieldToSchema<S[K]>
}

export function usePageQuery<S extends NormalizedQuerySchema>(
  props: Record<string, unknown>,
  schema: S,
): PageQuery<NormalizedQueryToSchema<S>>
export function usePageQuery<Q extends QuerySchema = Record<never, never>>(
  props: Record<string, unknown>,
  schema: NormalizedQuerySchema,
): PageQuery<Q>
export function usePageQuery<Q extends QuerySchema = Record<never, never>>(
  props: Record<string, unknown>,
  schema: NormalizedQuerySchema,
): PageQuery<Q> {
  const route: QueryRoute = { path: 'definePage', query: schema }
  return Object.freeze(parse(route, props)) as unknown as PageQuery<Q>
}

export function definePage<Q extends QuerySchema = Record<never, never>>(
  _options: PageDefinition<Q>,
): PageQuery<Q> {
  void _options
  return {} as PageQuery<Q>
}

export type {
  ConditionalPlatform,
  ConditionalPlatformToken,
  NormalizedQuerySchema,
  PageDefinition,
  PageMeta,
  PageQuery,
  QueryConstructor,
  QueryField,
  QueryFormatter,
  QuerySchema,
  QueryType,
  RouteQueryValue,
  UniRouteInfo,
} from './types'
