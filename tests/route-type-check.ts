import { definePage, navigateTo, parseQuery } from '../src/runtime'
import type { QueryType, RoutePath } from '../src/runtime'
import { routes } from '@blyou/uni-router/auto-routes'

export const indexPath: RoutePath = '/pages/index/index'
export const detailPath: RoutePath = '/pages/user/detail'
export const manifestPaths = routes.map(route => route.path) satisfies RoutePath[]

// @ts-expect-error unregistered paths are rejected
export const invalidPath: RoutePath = '/pages/not-registered'

export function checkRouteTypes() {
  navigateTo({
    url: '/pages/user/detail',
    query: {
      id: 42,
      preview: true,
      obj: { a: 1, b: 'demo', c: true },
    },
  })

  // @ts-expect-error unregistered paths are rejected by the route map
  navigateTo({ url: '/pages/not-registered' })
  // @ts-expect-error the required id query is missing
  navigateTo({ url: '/pages/user/detail' })
  // @ts-expect-error id must be a number
  navigateTo({ url: '/pages/user/detail', query: { id: '42' } })

  const query = parseQuery('/pages/user/detail', { id: '42' })
  return query.id satisfies number
}

export function checkPageDefinitionFields() {
  definePage({
    homepage: true,
    needLogin: true,
    style: { navigationBarTitleText: 'Home' },
    tabBar: { text: 'Home' },
    ifdef: ['WEB', 'MP-WEIXIN'],
    ifndef: ['MP-WEIXIN'],
    query: {},
  })
  // @ts-expect-error platform values must match uni-app conditional compilation identifiers
  definePage({ ifdef: ['not-a-platform'] })
  // @ts-expect-error platform values must use uppercase canonical identifiers
  definePage({ ifdef: ['mp-weixin'] })
  // @ts-expect-error path is generated from the file system
  definePage({ path: '/pages/other' })
  // @ts-expect-error type is not part of the definePage config
  definePage({ type: 'page' })
  // @ts-expect-error homepage must be a boolean
  definePage({ homepage: 'yes' })
}

export function checkDefinePageTypes() {
  const query = definePage({
    query: {
      id: Number,
      preview: { type: Boolean, required: false, format: JSON.parse },
      obj: { type: Object as QueryType<{ a: number }> },
    },
  })
  query.id satisfies number
  query.preview satisfies boolean | undefined
  query.obj.a satisfies number
  // @ts-expect-error page query is readonly
  query.id = 1
  // @ts-expect-error unknown query fields are rejected
  return query.unknown
}
