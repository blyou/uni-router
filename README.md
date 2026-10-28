# @blyou/uni-router

面向 uni-app 的文件系统路由生成插件。它在构建期扫描页面，将同一份路由清单同步为 `pages.json`、TypeScript RouteMap 和跨端运行期 API；运行时仍使用 uni-app 原生导航，不引入 Web History 或另一套路由表。

## 特性

- 根据真实页面文件生成主包与分包路由，保留 `index` 等物理路径。
- 使用 `@uni-helper/uni-pages-types` 定义页面、`pages.json` 和自定义元信息。
- 通过 `definePage` 声明页面元信息、启动首页与显式 query schema。
- 生成精确的路径、参数和 tabBar 类型，错误路径与错误参数在编译期报错。
- 提供 `navigateTo`、`redirectTo`、`reLaunch`、`switchTab` 和 `parseQuery`。
- 提供可动态添加、移除的全局导航拦截器，支持白名单、重定向和未注册路径兜底。
- 增量合并 JSONC，保留受管范围外的页面及现有应用配置。
- 运行期不依赖 Node、DOM、`URL` 或 `URLSearchParams`，可用于 H5、App 和小程序。

## 安装与接入

包内同时包含构建期 Vite 插件和运行期 API，应用代码会直接导入 `navigateTo`、`switchTab`、`parseQuery` 等模块，因此应按普通依赖安装：

```bash
pnpm add @blyou/uni-router
```

`@vue/compiler-sfc` 作为 peer 依赖由宿主项目提供，请确保其版本与项目使用的 Vue 3 编译器一致。插件会在构建期从项目根目录动态解析并使用宿主安装的编译器，不会把自身依赖的编译器代码打包进产物；如宿主使用了非标准路径，可通过 `compilerSfc` 指定模块名或路径。

在 `vite.config.ts` 中将插件放在 `uni()` 之前：

```ts
import uni from '@dcloudio/vite-plugin-uni'
import { defineConfig } from 'vite'
import UniRouter from '@blyou/uni-router/vite'

export default defineConfig({
  plugins: [UniRouter(), uni()],
})
```

默认扫描 `src/pages/**/*.vue`，生成或更新：

- `src/pages.json`
- `uni-router.d.ts`（项目根目录）

确保 `tsconfig.json` 包含 `uni-router.d.ts` 与 `src/**/*.d.ts`。如果编辑器尚未生成声明，可在 `src/env.d.ts` 中先加入路由的基础类型：

```ts
/// <reference types="@blyou/uni-router/client" />
```

## 页面声明

页面路径只由文件位置决定：

```text
src/pages/index/index.vue  -> /pages/index/index
src/pages/user/detail.vue  -> /pages/user/detail
```

在页面中使用 `definePage`：

```vue
<script setup lang="ts">
definePage({
  style: {
    navigationBarTitleText: '用户详情',
  },
  query: {
    id: Number,
    preview: { type: Boolean, required: false },
  },
})
</script>
```

`style`、`needLogin` 和 `tabBar` 写入 `pages.json`；`query` 只进入 RouteMap 和运行期清单，不会写入 `pages.json`。

### tabBar

在页面中声明 `tabBar` 后，插件会将该页面加入根 `tabBar.list`，并自动写入 `pagePath`。`index` 控制排序，数字越小越靠前，不会写入 `pages.json`：

```ts
definePage({
  tabBar: {
    text: '首页',
    iconPath: 'static/home.png',
    selectedIconPath: 'static/home-active.png',
    index: 0,
  },
})
```

tabBar 页面必须位于主包。根 `tabBar` 的其他字段会保留；`merge: true` 时，已有的手工 `list` 项在对应页面仍然存在时也会保留。生成的页面项和 tabBar 项会将 `path` / `pagePath` 放在首位，其余字段按字典序排列。

### 条件编译

使用 `ifdef` / `ifndef` 声明页面参与编译的平台，插件会将其转换为 uni-app 在 `pages.json` 中的条件编译注释，tabBar 项会同步加上相同条件：

```ts
definePage({
  ifdef: ['H5', 'MP-WEIXIN'],
  ifndef: ['APP-PLUS'],
})
```

平台值统一使用大写 `-` 分隔的 uni-app 条件编译标识，如 `H5`、`WEB`、`MP-WEIXIN`、`APP-PLUS`、`APP-ANDROID`、`QUICKAPP-WEBVIEW` 等。TypeScript 类型只接受大写规范形式；对于未经过类型检查的 JS 配置，生成前仍会归一化为大写。多个 `ifdef` 或 `ifndef` 值使用 `||` 组合；同时配置时按嵌套条件处理。

条件编译只影响 `pages.json` 中页面和 tabBar 的编译结果，RouteMap 仍会包含所有页面声明；在跨平台代码中导航到可能被排除的页面时，需要自行判断当前平台。

### homepage

使用 `homepage: true` 将页面设置为 uni-app 启动首页：

```ts
definePage({
  homepage: true,
})
```

配置后该页面始终位于 `pages` 第一位，其余页面继续按 `sort` 或默认规则排序。`homepage` 只控制页面顺序，不写入 `pages.json`；首页必须位于主包，且只能有一个页面设置。多个页面同时设置时会在编译期报错。

### query 规则

| 声明                                | TypeScript 类型                 | 是否必传 | `onLoad` 解析               |
| ----------------------------------- | ------------------------------- | -------- | --------------------------- |
| `String`                            | `string`                        | 是       | 保持字符串                  |
| `Number`                            | `number`                        | 是       | 转为有限数字                |
| `Boolean`                           | `boolean`                       | 是       | 仅接受 `'true'` / `'false'` |
| `Object` / `QueryType<T>`           | `Record<string, unknown>` / `T` | 是       | 默认调用 `JSON.parse`       |
| `{ type: String, required: false }` | `string \| undefined`           | 否       | 缺省时省略字段              |

`Number`、`Boolean` 和 `Object` 同样支持可选对象写法。未声明 query 的页面不接受任意参数。

类似 Vue 的 `PropType`，可用 `QueryType<T>` 声明精确对象类型：

```ts
import type { QueryType } from '@blyou/uni-router'

const query = definePage({
  query: {
    obj: {
      type: Object as QueryType<{ a: number; b: string; c: boolean }>,
    },
  },
})

query.obj.a // number
```

内联的 `T` 会同步生成到 RouteMap，typed 导航也能获得相同对象类型。导航时对象通过 `JSON.stringify` 序列化，页面解析时会先处理 uni-app 的 URL 编码，再默认通过 `JSON.parse` 还原；`format` 仍可覆盖默认行为。

### 静态宏限制

`definePage` 由插件静态分析并在编译时移除，不执行项目代码。参数必须是一个静态对象，仅支持：

- 对象、数组、字符串、数字、布尔值、`null` 和负数。
- `as const`、`satisfies` 和类型断言。
- 上述 query 构造器写法。

不支持变量引用、函数调用、模板字符串、spread、计算属性或动态表达式。每个页面最多调用一次。`definePage` 是全局宏，无需导入，由插件在编译时移除或替换为运行时代码。

## 类型安全导航

```vue
<script setup lang="ts">
import { navigateTo } from '@blyou/uni-router'

function openDetail() {
  navigateTo('/pages/user/detail', { id: 42, preview: true })
}

function openDetailWithOptions() {
  navigateTo(
    '/pages/user/detail',
    { id: 42 },
    {
      animationType: 'fade-in',
      success(result) {
        console.log('导航成功', result)
      },
    },
  )
}
</script>
```

导航函数使用 `(url, query?, options?)` 签名：`query` 根据页面 schema 推导，存在必填参数时必传；`options` 为对应 uni-app 原生导航参数，已移除其中的 `url`。`switchTab` 不支持 query，签名为 `(url, options?)`。`navigateTo`、`redirectTo`、`reLaunch` 的 `url` 只接受非 tabBar 页面，`switchTab` 的 `url` 只接受 tabBar 页面。

以下用法会在编译期报错；绕过类型后，运行期也会抛出带路径和参数名的错误：

- 未注册的路径。
- 缺少必填参数或传入额外参数。
- `number`、`boolean` 类型错误，以及 `NaN`、无穷大。
- 对象参数不是可 JSON 序列化的对象。
- 对非 tabBar 页面调用 `switchTab`，或给 `switchTab` 传 query。
- 对 tabBar 页面调用 `navigateTo`、`redirectTo` 或 `reLaunch`（编译期由路由类型拦截）。

参数名和值在拼接 URL 前会执行 `encodeURIComponent`，页面解析时会先尝试 `decodeURIComponent`，再按声明的类型转换；对象参数使用 `JSON.stringify` 序列化后再编码，避免 `&`、`#`、空格等字符破坏 URL。

`reLaunch` 使用相同的 query 规则。tabBar 页面跳转应使用 `switchTab`，并遵循 uni-app 各端原生导航限制。

### 页面 props 语法糖

在 `<script setup>` 中，可以直接接收 `definePage` 的返回值，无需手动编写 `onLoad`：

```vue
<script setup lang="ts">
const query = definePage({
  style: { navigationBarTitleText: '用户详情' },
  query: {
    id: Number,
    preview: { type: Boolean, required: false },
  },
})
</script>

<template>
  <text>{{ query.id }}</text>
  <text>{{ query.preview }}</text>
</template>
```

在 Vue 3 `<script setup>` 模式下，uni-app 会将页面参数作为 props 传入。插件会将该写法转换为页面 `defineProps`，并在页面 `setup` 时一次性解析参数，返回冻结的只读对象。`query.id` 为 `number`，`query.preview` 为 `boolean | undefined`；解析只执行一次，返回值不可修改，解析规则与 `parseQuery` 相同。页面参数在该页面实例生命周期内视为不变。

该语法糖只适用于 Vue 3 `<script setup>`；普通 `<script>` 和其他模式仍使用下方的 `onLoad` + `parseQuery` 方式。由于插件会生成 `defineProps`，同一个 `<script setup>` 中已存在 `defineProps` 时不能同时使用返回值写法，需要改为 `onLoad` + `parseQuery` 或自行合并页面 props。

字段可通过 `format` 覆盖默认解析逻辑。函数接收 URL 解码后的字符串，返回值必须与声明的 `type` 一致，并会继续接受运行期校验：

```ts
const query = definePage({
  query: {
    id: { type: Number, format: value => Number(value) },
    preview: { type: Boolean, required: false, format: JSON.parse },
  },
})
```

`format` 可以是 `JSON.parse` 等函数引用，也可以是使用页面作用域变量的内联函数。它在页面 `setup` 解析参数时执行一次；独立的 `parseQuery` 仍使用内置解析规则。

返回值语法仅支持 `<script setup>` 中的单个命名变量声明，例如 `const query = definePage(...)`。普通 `<script>`、解构或多个变量声明仍需使用下面的 `onLoad` 方式。

### 解析 `onLoad` 参数

```ts
import { onLoad } from '@dcloudio/uni-app'
import { parseQuery } from '@blyou/uni-router'

onLoad(query => {
  const params = parseQuery('/pages/user/detail', query ?? {})
  params.id // number
  params.preview // boolean | undefined
})
```

根包直接导出 `navigateTo`、`redirectTo`、`reLaunch`、`switchTab`、`parseQuery` 和 `interceptor`。路由清单在构建期生成到 `@blyou/uni-router/auto-routes`，运行时由根包直接引用，无需手动注册。需要读取清单时可单独导入：

```ts
import { routes } from '@blyou/uni-router/auto-routes'
```

## 导航拦截器

`interceptor` 是所有拦截规则的统一配置入口。它作用于根包导出的 `navigateTo`、`redirectTo`、`reLaunch` 和 `switchTab`，最终的页面跳转仍由 uni-app 原生 API 完成。

```ts
// src/plugins/router.ts
import { interceptor, navigateTo } from '@blyou/uni-router'
import { isLoggedIn } from '@/utils/auth'

const removeRouterInterceptor = interceptor({
  // 登录页和公开的 tabBar 页面跳过本拦截器的全部钩子
  whitelist: ['/pages/login/index', '/pages/index/index'],
  beforeEach(to) {
    // needLogin 来自 definePage({ needLogin: true })
    if (to.meta.needLogin && !isLoggedIn()) {
      return navigateTo('/pages/login/index', { to: to.path })
    }
  },
  afterEach(to, _from, result) {
    if (result.status === 'fail') {
      console.warn(`导航到 ${to.path} 失败`, result.data)
    }
  },
})

// 需要时可动态移除当前规则
// removeRouterInterceptor()
```

在应用入口引入一次：

```ts
// src/main.ts
import './plugins/router'
```

### 钩子与执行流程

| 钩子                  | 执行时机                                       |
| --------------------- | ---------------------------------------------- |
| `beforeEach`          | 所有导航的全局前置钩子，最先执行               |
| `beforeNavigateTo` 等 | 对应导航方式的专用前置钩子，在全局钩子之后执行 |
| `afterEach`           | 原生导航成功、失败或被取消后执行               |
| `notFound`            | 目标路径未注册时执行，替代默认的路由错误       |

一次导航依次经过：解析路径与参数 → 未注册路径交给 `notFound` → 执行 `beforeEach` → 执行对应方式的钩子 → 放行、取消或重定向 → 原生导航 → `afterEach`。

方法专用钩子统一使用 `before` 前缀：`beforeNavigateTo`、`beforeRedirectTo`、`beforeReLaunch`、`beforeSwitchTab`。

前置钩子的返回值：

| 返回值                              | 行为                                               |
| ----------------------------------- | -------------------------------------------------- |
| `false`                             | 取消导航，不调用原生 API                           |
| `true` / `undefined`                | 继续执行后续钩子                                   |
| `string`                            | 按 URL 重定向，默认使用 `redirectTo`               |
| `navigateTo(...)` 等导航 API 返回值 | 按该 API 指定的导航方式重定向                      |
| `{ url, method? }`                  | 按指定方式重定向                                   |
| `Promise`                           | 不支持，会立即抛错，避免异步守卫导致导航被静默放行 |

钩子内调用导航 API 不会立即跳转，而是返回本次导航的目标信息；直接 `return navigateTo(...)`、`return redirectTo(...)`、`return reLaunch(...)` 或 `return switchTab(...)` 即可重定向。钩子外调用导航 API 会立即执行，并返回同样的目标信息（`NavigationTarget`），可读取 `path`、`url`、`query`、`meta`、`tab` 等数据。

重定向目标会重新经过完整的拦截流程，并受 10 次上限保护，循环重定向会抛错。`notFound` 没有返回值或返回 `true` 时保留默认的 `Route is not registered` 错误。

`to` 提供 `path`、`url`、`query`、`meta`、`tab`、`querySchema`、`subPackage` 和 `method`；`from` 提供相同的位置字段，但可能为 `null`（例如应用启动早期或当前平台无法读取页面栈），部分平台只能读取当前页面路径，`from.query` 可能为空。`query` 是 URL 解码后的字符串参数，对象参数仍是 JSON 字符串；`querySchema` 是页面声明的参数 schema。未注册路径的 `meta` 为 `{}`、`tab` 为 `false`、`querySchema` 为 `{}`，但传入的 query 仍会序列化到 `to.url` 并可通过 `to.query` 读取。

`afterEach` 的 `result.status` 为 `success`、`fail` 或 `cancelled`。取消导航不会触发原调用的 `success`、`fail` 或 `complete` 回调；重定向会发起新的原生导航，原调用参数和回调不会继承。

### 白名单

`whitelist` 支持三种规则，命中后跳过当前这次 `interceptor` 注册的全部钩子：

```ts
interceptor({
  whitelist: [
    '/pages/login/index', // 精确路径，忽略首尾斜杠和 query
    /^\/pages\/public\//, // 正则匹配 to.path
    to => to.path.endsWith('/preview'), // 自定义判断
  ],
  beforeEach(to) {
    // ...
  },
})
```

白名单按注册项独立生效。多个模块各自注册拦截器时，一个模块的白名单不会关闭其他模块的校验。

### 动态添加与移除

重复调用会按注册顺序叠加规则；返回值是幂等的移除函数：

```ts
import { clearInterceptors, interceptor } from '@blyou/uni-router'

const removePermission = interceptor({
  beforeEach(to) {
    // ...
  },
})

// 动态移除，不会残留钩子引用
removePermission()
removePermission()

// 移除全部规则，主要用于应用销毁或测试清理
clearInterceptors()
```

建议在应用入口注册一次，不要在页面生命周期中反复注册。热更新场景可调用返回值，清理旧模块实例。

### 常见拦截场景

**登录态缺失**：对声明了 `needLogin` 的页面重定向到登录页，并把登录页放入白名单，避免重定向目标被再次拦截。

```ts
interceptor({
  whitelist: ['/pages/login/index'],
  beforeEach(to) {
    if (to.meta.needLogin && !isLoggedIn()) {
      return navigateTo('/pages/login/index', { to: to.path })
    }
  },
})
```

**无权限**：可以取消导航并提示，或重定向到统一的 403 页面。

```ts
const permissions: Record<string, string> = {
  '/pages/admin/index': 'admin',
}

interceptor({
  beforeEach(to) {
    const required = permissions[to.path]
    if (required && !hasPermission(required)) {
      uni.showToast({ title: '无权限访问', icon: 'none' })
      return false
      // 或：return reLaunch('/pages/error/403')
    }
  },
})
```

**未注册路径**：`notFound` 可兜底到首页或登录页；返回 `false` 则静默取消。

```ts
interceptor({
  notFound(to) {
    console.warn(`未注册路由：${to.path}`)
    return switchTab('/pages/index/index')
  },
})
```

**tabBar 页面**：`switchTab` 目标必须是 tabBar 页面且不能携带 query；`navigateTo`、`redirectTo`、`reLaunch` 的目标不能是 tabBar 页面。重定向到 tabBar 页面时直接返回 `switchTab(...)`。

### 边界与跨端说明

- 钩子必须同步返回结果。登录态刷新、权限请求等异步逻辑应先准备好状态，或在页面内自行处理。
- 只有根包导出的导航函数会经过拦截器；直接调用 `uni.navigateTo`、使用 `<navigator>`、点击原生 tabBar 或返回手势不会被拦截。
- 钩子内调用导航 API 不会立即跳转，只返回目标信息供钩子返回重定向，因此不要在钩子内只调用不返回，否则本次导航被吞掉；`afterEach` 中调用导航 API 不受此限制，会正常跳转。
- H5 直接输入 URL、刷新页面，以及 App 启动恢复页面时不一定经过导航函数，关键页面仍应在 `onShow` 中保留兜底校验。
- 重定向会重新校验目标页面的 query schema；目标页面未注册时进入 `notFound`。
- 拦截逻辑只使用 `Map`、`Set`、`getCurrentPages` 和 `uni` 原生导航，不依赖 DOM、Node、`URL` 或 `URLSearchParams`，可在 H5、App 和各小程序端运行。
- `afterEach` 钩子内部异常会被捕获并输出，不会阻断用户自己的原生导航回调；前置钩子异常会中断导航并向调用方抛出。

## 支持的页面配置

`definePage` 严格限制为以下七个字段：

| 字段        | 类型                    | 说明                                                   |
| ----------- | ----------------------- | ------------------------------------------------------ |
| `homepage`  | `boolean`               | 是否设为 uni-app 启动首页，只控制 `pages` 顺序。       |
| `ifdef`     | `ConditionalPlatform[]` | 仅在指定平台参与编译，写入 `pages.json` 条件编译注释。 |
| `ifndef`    | `ConditionalPlatform[]` | 在指定平台不参与编译，写入 `pages.json` 条件编译注释。 |
| `needLogin` | `boolean`               | 页面是否需要登录。                                     |
| `style`     | `GlobalStyle`           | 页面窗口配置，写入 `pages.json`。                      |
| `tabBar`    | `UserTabBarItem`        | 页面在底部 tabBar 中的配置，写入根 `tabBar.list`。     |
| `query`     | query schema            | 页面参数声明。                                         |

`path` 由文件系统生成，`type` 等其他 `UserPageMeta` 字段不再接受。

## 配置

```ts
UniRouter({
  compilerSfc: '@vue/compiler-sfc',
  srcDir: 'src',
  dirs: ['src/pages'],
  include: ['**/*.vue'],
  exclude: ['**/legacy/**'],
  pagesJson: 'src/pages.json',
  dts: 'uni-router.d.ts',
  defaultMeta: {
    style: { navigationBarTitleText: 'My App' },
  },
  merge: true,
  watch: true,
  sort: (a, b) => a.path.localeCompare(b.path),
})
```

| 选项          | 类型                               | 默认值                     | 说明                                                                    |
| ------------- | ---------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `compilerSfc` | `string`                           | `'@vue/compiler-sfc'`      | 从项目根目录解析的 SFC 编译器模块名或路径，优先使用宿主环境版本。       |
| `srcDir`      | `string`                           | `'src'`                    | uni-app 源码目录，页面运行路径以它为基准。                              |
| `dirs`        | `Array<string \| RouteDirOptions>` | `['<srcDir>/pages']`       | 一个或多个页面扫描目录。                                                |
| `include`     | `string[]`                         | `['**/*.vue']`             | 全局 include，可被目录配置覆盖；可扩展为 `.nvue`、`.uvue` 等 SFC 文件。 |
| `exclude`     | `string[]`                         | `[]`                       | 全局 exclude，可被目录配置覆盖。                                        |
| `pagesJson`   | `string`                           | `'<srcDir>/pages.json'`    | `pages.json` 路径。                                                     |
| `dts`         | `string \| false`                  | `'<root>/uni-router.d.ts'` | RouteMap 声明路径；设为 `false` 可关闭。                                |
| `defaultMeta` | `PageMeta`                         | `{}`                       | 页面默认元信息；`style` 与页面配置合并，其他字段由页面覆盖。            |
| `sort`        | `(a, b) => number`                 | 内置排序                   | 自定义页面排序，参数包含 `path`、`file`、`subPackage` 等。              |
| `merge`       | `boolean`                          | `true`                     | 是否保留受管范围外的既有页面及既有 tabBar 项。                          |
| `watch`       | `boolean`                          | `true`                     | 是否在开发/watch 模式同步页面增删改。                                   |

未提供 `sort` 时，默认优先 `pages/index/index`、`pages/index`，其余按路径排序；增量模式下会保留仍然有效的原启动页。提供 `sort` 后，以自定义结果为准。`homepage: true` 的页面优先于以上所有规则，始终排在 `pages` 第一位，其余页面再按 `sort` 或默认规则排序。

### 分包

```ts
UniRouter({
  dirs: ['src/pages', { src: 'src/subpackages/shop', subPackage: true }],
})
```

`src/subpackages/shop/cart.vue` 会生成：

```json
{
  "root": "subpackages/shop",
  "pages": [{ "path": "cart" }]
}
```

对应的运行期路径为 `/subpackages/shop/cart`。分包目录必须位于 `srcDir` 内。

### 增量迁移与删除规则

默认 `merge: true`：

- 受管目录内，扫描结果对应的页面会自动新增、更新和删除。
- 被 `exclude` 排除且已存在于 `pages.json` 的页面会保留，便于逐页迁移。
- 受管目录外的手工主包页面，以及未受管分包会保留。
- `globalStyle`、`easycom`、`condition`、平台配置和未知根字段不会被重建。
- 未使用页面级 `tabBar` 时，根 `tabBar` 保持原样；使用后由扫描结果重建 `list`，`merge: true` 时已有手工项在对应页面仍然存在时保留，`merge: false` 时仅保留扫描生成的项，`pagePath` 自动生成并移除 `index`。
- 未使用页面级 `tabBar` 时，删除仍被 `tabBar.list` 引用的页面会中止生成；使用后对应 list 项会自动移除。
- JSONC 以局部编辑方式写入，保留根级注释和受管字段之外的格式。

`merge: false` 时，既有 `pages`、`subPackages` 和 `tabBar.list` 完全以扫描结果为准；没有页面声明 `tabBar` 时根 `tabBar` 会被移除，其他应用级配置仍保留。

建议将生成的 `pages.json` 和 `uni-router.d.ts` 一并提交，保证编辑器、CI 和团队成员使用同一份路由类型。

## 多平台说明

文件扫描、SFC 解析和 JSONC 写入只发生在 Vite/Node 构建期。应用产物中的 runtime 仅使用 JavaScript 基础能力及 `uni.navigateTo` 等原生 API，因此不要求浏览器环境，也不改变各小程序、App 或 H5 的路由机制。

本方案不模拟 Vue Router 的 `children`、`:id`、catch-all 或 History 模式。动态数据通过显式 query 传递，物理页面路径始终遵循 uni-app 规范。

## 开发

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

`playground` 提供完整接入示例，可运行 `pnpm --filter uni-preset-vue build:h5` 或其他平台的 `build:*` 脚本验证生成结果。
