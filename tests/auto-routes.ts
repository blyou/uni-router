import type { UniRouteInfo } from '../src/types'

export const routes: readonly UniRouteInfo[] = [
  {
    path: '/pages/index/index',
    file: 'src/pages/index/index.vue',
    meta: {},
    query: {},
    tab: true,
  },
  {
    path: '/pages/user/detail',
    file: 'src/pages/user/detail.vue',
    meta: {},
    query: {
      id: { type: 'number', required: true },
      preview: { type: 'boolean', required: false },
    },
    tab: false,
  },
  {
    path: '/pages/object',
    file: 'src/pages/object.vue',
    meta: {},
    query: { obj: { type: 'object', required: true } },
    tab: false,
  },
]
