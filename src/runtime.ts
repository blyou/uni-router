/// <reference types="@dcloudio/types" />

import { routes } from '@blyou/uni-router/auto-routes'
import {
  hasAfterHooks,
  isCapturingNavigation,
  normalizeRoutePath,
  runAfterHooks,
  runBeforeGuards,
  runNotFoundGuards,
  type NavigationMethod,
  type NavigationRedirect,
  type NavigationTarget,
  type RouteLocation,
} from './interceptor'
import type {
  NormalizedQueryField,
  NormalizedQuerySchema,
  PageDefinition,
  PageQuery,
  QuerySchema,
  RouteQueryValue,
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

export type NavigateToOptions = Omit<UniNamespace.NavigateToOptions, 'url'>
export type RedirectToOptions = Omit<UniNamespace.RedirectToOptions, 'url'>
export type ReLaunchOptions = Omit<UniNamespace.ReLaunchOptions, 'url'>
export type SwitchTabOptions = Omit<UniNamespace.SwitchTabOptions, 'url'>

type NavigationArgs<P extends RoutePath, O> = [RequiredQueryKeys<P>] extends [never]
  ? [query?: RouteQuery<P>, options?: O]
  : [query: RouteQuery<P>, options?: O]

export type RouteRecord<P extends RoutePath = RoutePath> = P extends RoutePath
  ? {
      path: P
      meta: RouteMeta<P>
      query: NormalizedQuerySchema
      tab: UniRouteMap[P]['tab']
      subPackage?: string
    }
  : never

type NativeNavigationOptions = Record<string, unknown>

interface ParsedUrl {
  path: string
  url: string
  query: Record<string, string>
}

const MAX_REDIRECTS = 10

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

function parseUrl(url: string): ParsedUrl {
  const hash = url.indexOf('#')
  const withoutHash = hash >= 0 ? url.slice(0, hash) : url
  const question = withoutHash.indexOf('?')
  const rawPath = question >= 0 ? withoutHash.slice(0, question) : withoutHash
  const rawQuery = question >= 0 ? withoutHash.slice(question + 1) : ''
  const query: Record<string, string> = {}
  for (const pair of rawQuery.split('&')) {
    if (!pair) continue
    const equals = pair.indexOf('=')
    const name = decodeQueryValue(equals >= 0 ? pair.slice(0, equals) : pair)
    if (!name || name === '__proto__') continue
    query[name] = equals >= 0 ? decodeQueryValue(pair.slice(equals + 1)) : ''
  }
  const path = normalizeRoutePath(rawPath)
  return { path, url: rawQuery ? `${path}?${rawQuery}` : path, query }
}

function locationFromParsed(route: UniRouteInfo | undefined, parsed: ParsedUrl): RouteLocation {
  return {
    path: parsed.path,
    url: parsed.url,
    query: parsed.query,
    meta: route?.meta ?? {},
    tab: route?.tab ?? false,
    querySchema: route?.query ?? {},
    subPackage: route?.subPackage,
  }
}

function targetFromParsed(
  method: NavigationMethod,
  route: UniRouteInfo | undefined,
  parsed: ParsedUrl,
): NavigationTarget {
  return { method, ...locationFromParsed(route, parsed) }
}

function createTarget(
  method: NavigationMethod,
  route: UniRouteInfo | undefined,
  url: string,
): NavigationTarget {
  return targetFromParsed(method, route, parseUrl(url))
}

type CurrentPageLike = Page.PageInstance & {
  $page?: { fullPath?: string; path?: string }
}

function currentLocation(): RouteLocation | null {
  if (typeof getCurrentPages !== 'function') return null
  let pages: ReturnType<typeof getCurrentPages>
  try {
    pages = getCurrentPages()
  } catch {
    return null
  }
  const page = pages[pages.length - 1] as CurrentPageLike | undefined
  if (!page) return null
  const raw =
    typeof page.route === 'string' ? page.route : (page.$page?.fullPath ?? page.$page?.path)
  if (typeof raw !== 'string' || !raw) return null
  const parsed = parseUrl(raw)
  return locationFromParsed(routesByPath.get(parsed.path), parsed)
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

function queryValueType(value: unknown): RouteQueryValue | undefined {
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number' && Number.isFinite(value)) return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (value !== null && typeof value === 'object') return 'object'
  return undefined
}

function appendQuery(location: ParsedUrl, query: Record<string, unknown> | undefined): ParsedUrl {
  const pairs: string[] = []
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value == null) continue
    if (name === '__proto__')
      error(location.path, 'Query parameter name "__proto__" is not supported')
    const type = queryValueType(value)
    if (!type) {
      error(
        location.path,
        `Query parameter "${name}" must be a string, number, boolean, or JSON serializable object`,
      )
    }
    const serialized = queryValue(location.path, name, type, value)
    pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(serialized)}`)
  }
  if (!pairs.length) return location
  const separator = location.url.includes('?') ? '&' : '?'
  return parseUrl(`${location.url}${separator}${pairs.join('&')}`)
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

function callback(
  options: NativeNavigationOptions,
  name: 'success' | 'fail',
): ((result: unknown) => void) | undefined {
  const value = options[name]
  return typeof value === 'function' ? (value as (result: unknown) => void) : undefined
}

function notifyCancelled(target: NavigationTarget, from: RouteLocation | null) {
  runAfterHooks(target, from, { status: 'cancelled' })
}

function dispatchNavigation(
  method: NavigationMethod,
  target: NavigationTarget,
  from: RouteLocation | null,
  options: NativeNavigationOptions,
) {
  let nativeOptions: NativeNavigationOptions = { ...options, url: target.url }
  if (hasAfterHooks(target)) {
    // Read the user callbacks from the original options; the wrapper must not recurse.
    const success = callback(options, 'success')
    const fail = callback(options, 'fail')
    nativeOptions = {
      ...options,
      url: target.url,
      success(result: unknown) {
        runAfterHooks(target, from, { status: 'success', data: result })
        success?.(result)
      },
      fail(result: unknown) {
        runAfterHooks(target, from, { status: 'fail', data: result })
        fail?.(result)
      },
    }
  }
  if (method === 'navigateTo') {
    uni.navigateTo(nativeOptions as unknown as UniNamespace.NavigateToOptions)
  } else if (method === 'redirectTo') {
    uni.redirectTo(nativeOptions as unknown as UniNamespace.RedirectToOptions)
  } else if (method === 'reLaunch') {
    uni.reLaunch(nativeOptions as unknown as UniNamespace.ReLaunchOptions)
  } else {
    uni.switchTab(nativeOptions as unknown as UniNamespace.SwitchTabOptions)
  }
}

function redirectNavigation(
  redirect: NavigationRedirect,
  from: RouteLocation | null,
  depth: number,
) {
  const parsed = parseUrl(redirect.url)
  if (depth > MAX_REDIRECTS) {
    error(parsed.path, 'Navigation was redirected too many times')
  }
  const method = redirect.method ?? 'redirectTo'
  const route = routesByPath.get(parsed.path)
  if (!route) {
    handleMissingRoute(createMissingTarget(method, parsed), from, depth)
    return
  }
  if (method === 'switchTab') {
    if (!route.tab) error(parsed.path, 'Route is not a tabBar page')
    if (Object.keys(parsed.query).length) {
      error(parsed.path, 'switchTab does not support query parameters')
    }
  }
  // Reuse the parsed location instead of parsing the redirect url twice.
  proceedNavigation(method, targetFromParsed(method, route, parsed), {}, from, depth)
}

function createMissingTarget(method: NavigationMethod, location: ParsedUrl): NavigationTarget {
  return {
    method,
    path: location.path,
    url: location.url,
    query: location.query,
    meta: {},
    tab: false,
    querySchema: {},
  }
}

function handleMissingRoute(
  target: NavigationTarget,
  from: RouteLocation | null,
  depth: number,
): NavigationTarget {
  const decision = runNotFoundGuards(target, from)
  if (decision.type === 'cancel') {
    notifyCancelled(target, from)
    return target
  }
  if (decision.type === 'redirect' && decision.redirect) {
    redirectNavigation(decision.redirect, from, depth + 1)
    return target
  }
  error(target.path, 'Route is not registered')
}

function proceedNavigation(
  method: NavigationMethod,
  target: NavigationTarget,
  options: NativeNavigationOptions,
  from: RouteLocation | null,
  depth: number,
) {
  const decision = runBeforeGuards(target, from)
  if (decision.type === 'cancel') {
    notifyCancelled(target, from)
    return
  }
  if (decision.type === 'redirect' && decision.redirect) {
    redirectNavigation(decision.redirect, from, depth + 1)
    return
  }
  dispatchNavigation(method, target, from, options)
}

function navigate(
  method: 'navigateTo' | 'redirectTo' | 'reLaunch',
  url: string,
  query: Record<string, unknown> | undefined,
  options: NativeNavigationOptions | undefined,
): NavigationTarget {
  const from = currentLocation()
  const route = routesByPath.get(url)
  if (!route) {
    const target = createMissingTarget(method, appendQuery(parseUrl(url), query))
    if (isCapturingNavigation()) return target
    return handleMissingRoute(target, from, 0)
  }
  const target = createTarget(method, route, serializeQuery(route, query))
  if (isCapturingNavigation()) return target
  proceedNavigation(method, target, options ?? {}, from, 0)
  return target
}

export function navigateTo<P extends RoutePath>(
  url: P,
  ...args: NavigationArgs<P, NavigateToOptions>
): NavigationTarget {
  return navigate('navigateTo', url, args[0], args[1])
}

export function redirectTo<P extends RoutePath>(
  url: P,
  ...args: NavigationArgs<P, RedirectToOptions>
): NavigationTarget {
  return navigate('redirectTo', url, args[0], args[1])
}

export function reLaunch<P extends RoutePath>(
  url: P,
  ...args: NavigationArgs<P, ReLaunchOptions>
): NavigationTarget {
  return navigate('reLaunch', url, args[0], args[1])
}

export function switchTab<P extends TabRoutePath>(
  url: P,
  options?: SwitchTabOptions,
): NavigationTarget {
  const from = currentLocation()
  const route = routesByPath.get(url)
  if (!route) {
    const target = createMissingTarget('switchTab', parseUrl(url))
    if (isCapturingNavigation()) return target
    return handleMissingRoute(target, from, 0)
  }
  if (!route.tab) error(url, 'Route is not a tabBar page')
  if (options && 'query' in options) error(url, 'switchTab does not support query parameters')
  const target = createTarget('switchTab', route, route.path)
  if (isCapturingNavigation()) return target
  proceedNavigation('switchTab', target, options ?? {}, from, 0)
  return target
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

export { clearInterceptors, interceptor } from './interceptor'
export type {
  AfterEachHook,
  InterceptorOptions,
  NavigationGuard,
  NavigationGuardResult,
  NavigationMethod,
  NavigationResult,
  NavigationRedirect,
  NavigationTarget,
  RemoveInterceptor,
  RouteLocation,
  Whitelist,
  WhitelistMatcher,
  WhitelistRule,
} from './interceptor'

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
