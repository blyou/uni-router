import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  clearInterceptors,
  interceptor,
  navigateTo,
  redirectTo,
  switchTab,
  type AfterEachHook,
  type NavigationGuard,
} from '../src/runtime'

type NativeNavigationOptions = {
  url: string
  success?: (result: unknown) => void
  fail?: (result: unknown) => void
  complete?: (result: unknown) => void
}

type NavigationBehavior = 'success' | 'fail'

const navigateUnsafe = navigateTo as (url: string, query?: Record<string, unknown>) => void
const switchTabUnsafe = switchTab as (url: string) => void

function mockUni(behavior: NavigationBehavior = 'success') {
  const invoke = (options: NativeNavigationOptions) => {
    const result = { errMsg: `mock:${behavior}` }
    if (behavior === 'success') options.success?.(result)
    else options.fail?.(result)
    options.complete?.(result)
  }
  const methods = {
    navigateTo: vi.fn<(options: NativeNavigationOptions) => void>(invoke),
    redirectTo: vi.fn<(options: NativeNavigationOptions) => void>(invoke),
    reLaunch: vi.fn<(options: NativeNavigationOptions) => void>(invoke),
    switchTab: vi.fn<(options: NativeNavigationOptions) => void>(invoke),
  }
  vi.stubGlobal('uni', methods)
  return methods
}

function stubCurrentPage(route?: string) {
  vi.stubGlobal('getCurrentPages', () => (route ? [{ route }] : []))
}

afterEach(() => {
  clearInterceptors()
  vi.unstubAllGlobals()
})

describe('navigation interceptors', () => {
  test('runs global and method guards before navigation and reports success afterwards', () => {
    const uni = mockUni()
    stubCurrentPage('pages/index/index')
    const events: string[] = []
    interceptor({
      beforeEach(to, from) {
        events.push(`before:${to.method}:${to.path}:${from?.path ?? 'none'}`)
        expect(to.meta).toEqual({})
        expect(to.tab).toBe(false)
        expect(to.querySchema).toHaveProperty('id')
        expect(from?.tab).toBe(true)
      },
      beforeNavigateTo(to) {
        events.push(`navigateTo:${to.url}`)
      },
      beforeRedirectTo() {
        events.push('redirectTo')
      },
      afterEach(to, from, result) {
        events.push(`after:${result.status}:${to.path}:${from?.path ?? 'none'}`)
      },
    })
    const success = vi.fn<(result: unknown) => void>()

    navigateTo('/pages/user/detail', { id: 42 }, { success })

    expect(uni.navigateTo).toHaveBeenCalledTimes(1)
    expect(uni.navigateTo.mock.calls[0][0]).toMatchObject({
      url: '/pages/user/detail?id=42',
      success: expect.any(Function),
    })
    expect(uni.redirectTo).not.toHaveBeenCalled()
    expect(success).toHaveBeenCalledWith({ errMsg: 'mock:success' })
    expect(events).toEqual([
      'before:navigateTo:/pages/user/detail:/pages/index/index',
      'navigateTo:/pages/user/detail?id=42',
      'after:success:/pages/user/detail:/pages/index/index',
    ])
  })

  test('only invokes the hook matching the navigation method', () => {
    const uni = mockUni()
    const navigateHook = vi.fn<NavigationGuard>()
    const redirectHook = vi.fn<NavigationGuard>()
    const switchTabHook = vi.fn<NavigationGuard>()
    interceptor({
      beforeNavigateTo: navigateHook,
      beforeRedirectTo: redirectHook,
      beforeSwitchTab: switchTabHook,
    })

    navigateTo('/pages/login/index')
    redirectTo('/pages/login/index')
    switchTab('/pages/index/index')

    expect(navigateHook).toHaveBeenCalledTimes(1)
    expect(redirectHook).toHaveBeenCalledTimes(1)
    expect(switchTabHook).toHaveBeenCalledTimes(1)
    expect(uni.navigateTo).toHaveBeenCalledTimes(1)
    expect(uni.redirectTo).toHaveBeenCalledTimes(1)
    expect(uni.switchTab).toHaveBeenCalledTimes(1)
  })

  test('cancels navigation when a guard returns false', () => {
    const uni = mockUni()
    const after = vi.fn<AfterEachHook>()
    interceptor({ beforeEach: () => false, afterEach: after })
    const success = vi.fn<(result: unknown) => void>()
    const fail = vi.fn<(result: unknown) => void>()

    navigateTo('/pages/user/detail', { id: 1 }, { success, fail })

    expect(uni.navigateTo).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledTimes(1)
    expect(after.mock.calls[0][2]).toEqual({ status: 'cancelled' })
  })

  test('skips all hooks for whitelisted paths', () => {
    const uni = mockUni()
    const before = vi.fn<NavigationGuard>(() => false)
    const after = vi.fn<AfterEachHook>()
    interceptor({
      whitelist: [
        'pages/login/index/',
        /^\/pages\/login\//,
        to => to.path === '/pages/login/index',
      ],
      beforeEach: before,
      afterEach: after,
    })

    navigateTo('/pages/login/index')

    expect(uni.navigateTo).toHaveBeenCalledTimes(1)
    expect(before).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()

    navigateTo('/pages/user/detail', { id: 1 })

    expect(before).toHaveBeenCalledTimes(1)
    expect(after).toHaveBeenCalledTimes(1)
    expect(uni.navigateTo).toHaveBeenCalledTimes(1)
  })

  test('redirects when a guard returns a target url', () => {
    const uni = mockUni()
    interceptor({
      whitelist: ['/pages/login/index'],
      beforeEach(to) {
        if (to.path === '/pages/user/detail') {
          return '/pages/login/index?from=detail'
        }
      },
    })

    navigateTo('/pages/user/detail', { id: 1 })

    expect(uni.navigateTo).not.toHaveBeenCalled()
    expect(uni.redirectTo).toHaveBeenCalledTimes(1)
    expect(uni.redirectTo.mock.calls[0][0]).toMatchObject({
      url: '/pages/login/index?from=detail',
    })
  })

  test('honors redirect method overrides', () => {
    const uni = mockUni()
    interceptor({
      beforeEach(to) {
        if (to.method === 'redirectTo') {
          return { url: '/pages/index/index', method: 'switchTab' }
        }
      },
    })

    redirectTo('/pages/login/index')

    expect(uni.redirectTo).not.toHaveBeenCalled()
    expect(uni.switchTab).toHaveBeenCalledTimes(1)
    expect(uni.switchTab.mock.calls[0][0]).toMatchObject({ url: '/pages/index/index' })
  })

  test('accepts navigation API results as guard redirects', () => {
    const uni = mockUni()
    interceptor({
      beforeEach(to) {
        if (to.path === '/pages/login/index') {
          return navigateTo('/pages/user/detail', { id: 1 })
        }
      },
    })

    const info = navigateTo('/pages/login/index')

    expect(info).toMatchObject({
      method: 'navigateTo',
      path: '/pages/login/index',
      url: '/pages/login/index',
    })
    expect(uni.navigateTo).toHaveBeenCalledTimes(1)
    expect(uni.navigateTo.mock.calls[0][0]).toMatchObject({ url: '/pages/user/detail?id=1' })
  })

  test('accepts navigation API results from notFound', () => {
    const uni = mockUni()
    interceptor({
      notFound() {
        return navigateTo('/pages/user/detail', { id: 404 })
      },
    })

    navigateUnsafe('/pages/missing', { path: '/pages/unknown' })

    expect(uni.navigateTo).toHaveBeenCalledTimes(1)
    expect(uni.navigateTo.mock.calls[0][0]).toMatchObject({
      url: '/pages/user/detail?id=404',
    })
  })

  test('handles unregistered paths with notFound and preserves the default error', () => {
    const uni = mockUni()
    interceptor({
      notFound(to) {
        expect(to.meta).toEqual({})
        expect(to.tab).toBe(false)
        expect(to.querySchema).toEqual({})
        expect(to.path).toBe('/pages/missing')
        return { url: '/pages/login/index', method: 'redirectTo' }
      },
    })

    navigateUnsafe('/pages/missing')

    expect(uni.navigateTo).not.toHaveBeenCalled()
    expect(uni.redirectTo).toHaveBeenCalledTimes(1)
    expect(uni.redirectTo.mock.calls[0][0]).toMatchObject({ url: '/pages/login/index' })

    clearInterceptors()
    expect(() => navigateUnsafe('/pages/missing')).toThrow('Route is not registered')
  })

  test('passes query values to notFound for unregistered paths', () => {
    const uni = mockUni()
    const notFound = vi.fn<NavigationGuard>(to => {
      expect(to.url).toBe('/pages/missing?test=1&obj=%7B%22a%22%3A1%7D')
      expect(to.query).toEqual({ test: '1', obj: '{"a":1}' })
      return false
    })
    interceptor({ notFound })

    navigateUnsafe('/pages/missing', { test: 1, obj: { a: 1 } })

    expect(notFound).toHaveBeenCalledTimes(1)
    expect(uni.navigateTo).not.toHaveBeenCalled()
  })

  test('cancels unregistered navigation when notFound returns false', () => {
    const uni = mockUni()
    interceptor({ notFound: () => false })

    navigateUnsafe('/pages/missing')

    expect(uni.navigateTo).not.toHaveBeenCalled()
    expect(uni.redirectTo).not.toHaveBeenCalled()
  })

  test('adds and removes rules dynamically without leaking callbacks', () => {
    const uni = mockUni()
    const first = vi.fn<NavigationGuard>()
    const removeFirst = interceptor({ beforeEach: first })
    const second = vi.fn<NavigationGuard>()
    interceptor({ beforeEach: second })

    navigateTo('/pages/login/index')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    removeFirst()
    removeFirst()
    navigateTo('/pages/login/index')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)

    clearInterceptors()
    navigateTo('/pages/login/index')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    expect(uni.navigateTo).toHaveBeenCalledTimes(3)
  })

  test('reports native failure to afterEach and preserves user callbacks', () => {
    const uni = mockUni('fail')
    const results: unknown[] = []
    const fail = vi.fn<(result: unknown) => void>()
    interceptor({
      afterEach(_to, _from, result) {
        results.push(result)
      },
    })

    navigateTo('/pages/login/index', undefined, { fail })

    expect(uni.navigateTo).toHaveBeenCalledTimes(1)
    expect(fail).toHaveBeenCalledWith({ errMsg: 'mock:fail' })
    expect(results).toEqual([{ status: 'fail', data: { errMsg: 'mock:fail' } }])
  })

  test('keeps route validation intact when interceptors are registered', () => {
    const uni = mockUni()
    const guard = vi.fn<NavigationGuard>()
    interceptor({ beforeEach: guard })

    expect(() => navigateUnsafe('/pages/user/detail')).toThrow('Missing required query')
    expect(() => switchTabUnsafe('/pages/user/detail')).toThrow('not a tabBar page')
    expect(guard).not.toHaveBeenCalled()
    expect(uni.navigateTo).not.toHaveBeenCalled()
    expect(uni.switchTab).not.toHaveBeenCalled()
  })

  test('stops cyclic redirects', () => {
    const uni = mockUni()
    interceptor({
      beforeEach(to) {
        return to.path === '/pages/login/index' ? '/pages/user/detail' : '/pages/login/index'
      },
    })

    expect(() => navigateTo('/pages/login/index')).toThrow(
      'Navigation was redirected too many times',
    )
    expect(uni.navigateTo).not.toHaveBeenCalled()
    expect(uni.redirectTo).not.toHaveBeenCalled()
  })

  test('rejects async guards instead of silently allowing navigation', () => {
    const uni = mockUni()
    interceptor({
      beforeEach: (() => Promise.resolve(true)) as never,
    })

    expect(() => navigateTo('/pages/login/index')).toThrow(
      'Async navigation guards are not supported',
    )
    expect(uni.navigateTo).not.toHaveBeenCalled()
  })

  test('aborts navigation when a guard throws', () => {
    const uni = mockUni()
    interceptor({
      beforeEach() {
        throw new Error('guard failed')
      },
    })

    expect(() => navigateTo('/pages/login/index')).toThrow('guard failed')
    expect(uni.navigateTo).not.toHaveBeenCalled()
  })
})
