import type { UniRouteInfo } from '../src/types'

export const routes: readonly UniRouteInfo[] = [
  {
    path: '/pages/index/index',
    meta: {},
    query: {},
    tab: true,
  },
  {
    path: '/pages/user/detail',
    meta: {},
    query: {
      id: { type: 'number', required: true },
      preview: { type: 'boolean', required: false },
    },
    tab: false,
  },
  {
    path: '/pages/object',
    meta: {},
    query: { obj: { type: 'object', required: true } },
    tab: false,
  },
]
