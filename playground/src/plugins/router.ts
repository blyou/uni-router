import { interceptor, navigateTo } from '@blyou/uni-router'
import { isLoggedIn } from '../utils/auth'

interceptor({
  // 登录页与 tabBar 页面无需登录，直接跳过本拦截器的校验
  whitelist: ['/pages/login/index', '/pages/index/index', '/pages/mine/index'],
  beforeEach(to) {
    console.log('beforeEach', to)
    if (to.meta.needLogin && !isLoggedIn()) {
      // 登录态缺失时中断原导航，并重定向到登录页；to 携带登录后的回跳路径
      return navigateTo('/pages/login/index', { to: to.path })
    }
  },
  notFound(to) {
    console.log('notFound', to)
    // 未注册路由统一兜底到 404 页面，并带上原始地址便于排查
    return navigateTo('/pages/404/index', { path: to.url })
  },
  afterEach(to, _from, result) {
    if (result.status === 'fail') {
      console.warn(`[router] 导航到 ${to.path} 失败`, result.data)
    }
  },
})
