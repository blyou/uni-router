import { interceptor } from '@blyou/uni-router'
import { isLoggedIn } from '../utils/auth'

const removeRouterInterceptor = interceptor({
  // 登录页与 tabBar 页面无需登录，直接跳过本拦截器的校验
  whitelist: ['/pages/login/index', '/pages/index/index', '/pages/mine/index'],
  beforeEach(to) {
    console.log(to)
    if (to.meta.needLogin && !isLoggedIn()) {
      // 登录态缺失时中断原导航，并重定向到登录页
      return { url: '/pages/login/index', method: 'navigateTo' }
    }
  },
  notFound(to) {
    // 未注册路由统一兜底到 404 页面，并带上原始地址便于排查
    return {
      url: `/pages/404/index?path=${encodeURIComponent(to.url)}`,
      method: 'navigateTo',
    }
  },
  afterEach(to, _from, result) {
    if (result.status === 'fail') {
      console.warn(`[router] 导航到 ${to.path} 失败`, result.data)
    }
  },
})

// 模块热更新或应用卸载时移除规则，避免重复注册
if (import.meta.hot) {
  import.meta.hot.dispose(() => removeRouterInterceptor())
}
