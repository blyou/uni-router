import type { NormalizedQuerySchema, PageMeta } from './types'

export type NavigationMethod = 'navigateTo' | 'redirectTo' | 'reLaunch' | 'switchTab'

export interface RouteLocation {
  /** 路由路径，不含 query，始终以 `/` 开头 */
  path: string
  /** 完整 URL；无法读取旧页面参数时可能只包含 path */
  url: string
  /** URL 解码后的 query 参数 */
  query: Record<string, string>
  /** 页面元信息；未注册路径时为空对象 */
  meta: PageMeta
  /** 是否为 tabBar 页面；未注册路径时为 false */
  tab: boolean
  /** 页面参数 schema；未注册路径时为空对象 */
  querySchema: NormalizedQuerySchema
  /** 分包根目录 */
  subPackage?: string
}

export interface NavigationTarget extends RouteLocation {
  /** 本次导航使用的方式 */
  method: NavigationMethod
}

export interface NavigationRedirect {
  /** 目标页面路径或带 query 的 URL */
  url: string
  /** 重定向使用的导航方式，默认 `redirectTo` */
  method?: NavigationMethod
}

export interface NavigationResult {
  /** `cancelled` 表示被拦截器取消，未调用原生导航 */
  status: 'success' | 'fail' | 'cancelled'
  /** 原生 success/fail 回调数据；cancelled 时为空 */
  data?: unknown
}

/** 返回 `false` 取消导航；返回 URL、重定向对象或导航 API 结果则跳转到新目标 */
export type NavigationGuardResult = boolean | void | string | NavigationRedirect | NavigationTarget
export type NavigationGuard = (
  to: NavigationTarget,
  from: RouteLocation | null,
) => NavigationGuardResult
export type AfterEachHook = (
  to: NavigationTarget,
  from: RouteLocation | null,
  result: NavigationResult,
) => void
export type WhitelistMatcher = (to: RouteLocation) => boolean
export type WhitelistRule = string | RegExp | WhitelistMatcher
export type Whitelist = WhitelistRule | readonly WhitelistRule[]

export interface InterceptorOptions {
  /**
   * 命中后跳过当前拦截器的全部钩子
   *
   * 每次 `interceptor` 注册独立匹配，不会影响其他拦截器
   */
  whitelist?: Whitelist
  /** 所有导航方式执行前调用，最先执行 */
  beforeEach?: NavigationGuard
  /** 导航结束或被取消时调用 */
  afterEach?: AfterEachHook
  /** 仅 `navigateTo` 执行前调用 */
  beforeNavigateTo?: NavigationGuard
  /** 仅 `redirectTo` 执行前调用 */
  beforeRedirectTo?: NavigationGuard
  /** 仅 `reLaunch` 执行前调用 */
  beforeReLaunch?: NavigationGuard
  /** 仅 `switchTab` 执行前调用 */
  beforeSwitchTab?: NavigationGuard
  /** 命中未注册路径时调用；返回 `false` 取消导航 */
  notFound?: NavigationGuard
}

export type RemoveInterceptor = () => void

export interface NavigationGuardDecision {
  type: 'allow' | 'cancel' | 'redirect'
  redirect?: NavigationRedirect
}

interface InterceptorRecord {
  whitelist: readonly WhitelistRule[]
  beforeEach?: NavigationGuard
  afterEach?: AfterEachHook
  beforeNavigateTo?: NavigationGuard
  beforeRedirectTo?: NavigationGuard
  beforeReLaunch?: NavigationGuard
  beforeSwitchTab?: NavigationGuard
  notFound?: NavigationGuard
}

const interceptors = new Set<InterceptorRecord>()

let capturingNavigation = false

/**
 * 是否正在执行拦截器钩子
 *
 * 钩子内调用导航 API 时只返回目标信息，不立即跳转，便于钩子直接返回该信息触发重定向
 */
export function isCapturingNavigation(): boolean {
  return capturingNavigation
}

const hookNames = [
  'beforeEach',
  'afterEach',
  'beforeNavigateTo',
  'beforeRedirectTo',
  'beforeReLaunch',
  'beforeSwitchTab',
  'notFound',
] as const

const methodHooks = {
  navigateTo: 'beforeNavigateTo',
  redirectTo: 'beforeRedirectTo',
  reLaunch: 'beforeReLaunch',
  switchTab: 'beforeSwitchTab',
} as const satisfies Record<NavigationMethod, keyof InterceptorRecord>

function guardError(location: RouteLocation, message: string): never {
  throw new Error(`[uni-router] ${location.path}: ${message}`)
}

function isNavigationMethod(value: unknown): value is NavigationMethod {
  return (
    value === 'navigateTo' ||
    value === 'redirectTo' ||
    value === 'reLaunch' ||
    value === 'switchTab'
  )
}

/** 归一化路由路径，移除 query/hash、补齐开头斜杠并合并结尾斜杠 */
export function normalizeRoutePath(value: string): string {
  let end = value.length
  const query = value.indexOf('?')
  const hash = value.indexOf('#')
  if (query >= 0) end = Math.min(end, query)
  if (hash >= 0) end = Math.min(end, hash)
  const trimmed = value.slice(0, end).replace(/^\/+/, '').replace(/\/+$/, '')
  return trimmed ? `/${trimmed}` : '/'
}

function normalizeWhitelist(whitelist: Whitelist | undefined): readonly WhitelistRule[] {
  if (whitelist === undefined) return []
  const rules =
    typeof whitelist === 'string' || typeof whitelist === 'function' || whitelist instanceof RegExp
      ? [whitelist]
      : [...whitelist]
  for (const rule of rules) {
    if (typeof rule !== 'string' && typeof rule !== 'function' && !(rule instanceof RegExp)) {
      throw new Error('[uni-router] Whitelist rules must be strings, RegExp objects, or functions')
    }
  }
  return rules
}

function matchesWhitelist(rules: readonly WhitelistRule[], location: RouteLocation): boolean {
  for (const rule of rules) {
    if (typeof rule === 'string') {
      if (normalizeRoutePath(rule) === location.path) return true
    } else if (rule instanceof RegExp) {
      rule.lastIndex = 0
      if (rule.test(location.path)) return true
    } else if (rule(location)) {
      return true
    }
  }
  return false
}

function redirectResult(
  value: string | NavigationRedirect,
  location: RouteLocation,
): NavigationGuardDecision {
  if (typeof value === 'string') {
    if (!value) guardError(location, 'Navigation redirect requires a non-empty url')
    return { type: 'redirect', redirect: { url: value } }
  }
  if (typeof value.url !== 'string' || !value.url) {
    guardError(location, 'Navigation redirect requires a non-empty url')
  }
  if (value.method !== undefined && !isNavigationMethod(value.method)) {
    guardError(location, `Unknown navigation method "${String(value.method)}"`)
  }
  return {
    type: 'redirect',
    redirect: value.method ? { url: value.url, method: value.method } : { url: value.url },
  }
}

function runGuard(
  guard: NavigationGuard | undefined,
  to: NavigationTarget,
  from: RouteLocation | null,
): NavigationGuardDecision | undefined {
  if (!guard) return undefined
  let value: unknown
  const previous = capturingNavigation
  capturingNavigation = true
  try {
    value = guard(to, from)
  } finally {
    capturingNavigation = previous
  }
  if (value === false) return { type: 'cancel' }
  if (typeof value === 'string') return redirectResult(value, to)
  if (value !== null && typeof value === 'object') {
    if (typeof (value as PromiseLike<unknown>).then === 'function') {
      guardError(to, 'Async navigation guards are not supported')
    }
    if ('url' in value) {
      return redirectResult(value as NavigationRedirect, to)
    }
  }
  return undefined
}

/**
 * 注册一组导航拦截规则
 *
 * 重复调用会按注册顺序叠加；返回值用于动态移除当前规则
 */
export function interceptor(options: InterceptorOptions): RemoveInterceptor {
  if (!options || typeof options !== 'object') {
    throw new Error('[uni-router] interceptor() expects an options object')
  }
  for (const name of hookNames) {
    const hook = options[name]
    if (hook !== undefined && typeof hook !== 'function') {
      throw new Error(`[uni-router] interceptor option "${name}" must be a function`)
    }
  }
  const record: InterceptorRecord = {
    whitelist: normalizeWhitelist(options.whitelist),
    beforeEach: options.beforeEach,
    afterEach: options.afterEach,
    beforeNavigateTo: options.beforeNavigateTo,
    beforeRedirectTo: options.beforeRedirectTo,
    beforeReLaunch: options.beforeReLaunch,
    beforeSwitchTab: options.beforeSwitchTab,
    notFound: options.notFound,
  }
  interceptors.add(record)
  let removed = false
  return () => {
    if (removed) return
    removed = true
    interceptors.delete(record)
  }
}

/** 移除全部拦截规则，主要用于应用销毁或测试清理 */
export function clearInterceptors() {
  interceptors.clear()
}

/** 依次执行 beforeEach，再执行对应导航方式的钩子 */
export function runBeforeGuards(
  to: NavigationTarget,
  from: RouteLocation | null,
): NavigationGuardDecision {
  const records = Array.from(interceptors)
  for (const record of records) {
    if (matchesWhitelist(record.whitelist, to)) continue
    const decision = runGuard(record.beforeEach, to, from)
    if (decision) return decision
  }
  for (const record of records) {
    if (matchesWhitelist(record.whitelist, to)) continue
    const decision = runGuard(record[methodHooks[to.method]], to, from)
    if (decision) return decision
  }
  return { type: 'allow' }
}

/** 依次执行未注册路径的兜底钩子 */
export function runNotFoundGuards(
  to: NavigationTarget,
  from: RouteLocation | null,
): NavigationGuardDecision {
  for (const record of Array.from(interceptors)) {
    if (matchesWhitelist(record.whitelist, to)) continue
    const decision = runGuard(record.notFound, to, from)
    if (decision) return decision
  }
  return { type: 'allow' }
}

/** 是否存在需要参与本次导航的 afterEach；用于决定是否包装原生回调 */
export function hasAfterHooks(to: NavigationTarget): boolean {
  for (const record of interceptors) {
    if (record.afterEach && !matchesWhitelist(record.whitelist, to)) return true
  }
  return false
}

/** 执行 afterEach；钩子异常不会影响原生导航回调 */
export function runAfterHooks(
  to: NavigationTarget,
  from: RouteLocation | null,
  result: NavigationResult,
): void {
  for (const record of Array.from(interceptors)) {
    if (!record.afterEach || matchesWhitelist(record.whitelist, to)) continue
    try {
      record.afterEach(to, from, result)
    } catch (error) {
      console.error('[uni-router] afterEach interceptor failed:', error)
    }
  }
}
