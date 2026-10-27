# @blyou/uni-router

面向 uni-app 的文件系统路由生成插件。它在构建期扫描页面，将同一份路由清单同步为 `pages.json`、TypeScript RouteMap 和跨端运行期 API；运行时仍使用 uni-app 原生导航，不引入 Web History 或另一套路由表。

## 特性

- 根据真实页面文件生成主包与分包路由，保留 `index` 等物理路径。
- 使用 `@uni-helper/uni-pages-types` 定义页面、`pages.json` 和自定义元信息。
- 通过 `definePage` 声明页面元信息、启动首页与显式 query schema。
- 生成精确的路径、参数和 tabBar 类型，错误路径与错误参数在编译期报错。
- 提供 `navigateTo`、`redirectTo`、`reLaunch`、`switchTab` 和 `parseQuery`。
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
  plugins: [
    UniRouter(),
    uni(),
  ],
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

平台值使用 uni-app 条件编译标识，如 `H5`、`WEB`、`MP-WEIXIN`、`APP-PLUS`、`APP-ANDROID`、`QUICKAPP-WEBVIEW` 等，同时接受小写形式和 `_` 分隔写法，生成时统一归一化为大写 `-` 形式。多个 `ifdef` 或 `ifndef` 值使用 `||` 组合；同时配置时按嵌套条件处理。

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

| 声明 | TypeScript 类型 | 是否必传 | `onLoad` 解析 |
| --- | --- | --- | --- |
| `String` | `string` | 是 | 保持字符串 |
| `Number` | `number` | 是 | 转为有限数字 |
| `Boolean` | `boolean` | 是 | 仅接受 `'true'` / `'false'` |
| `Object` / `QueryType<T>` | `Record<string, unknown>` / `T` | 是 | 默认调用 `JSON.parse` |
| `{ type: String, required: false }` | `string \| undefined` | 否 | 缺省时省略字段 |

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

query.obj.a  // number
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
  navigateTo({
    url: '/pages/user/detail',
    query: { id: 42, preview: true },
  })
}
</script>
```

以下用法会在编译期报错；绕过类型后，运行期也会抛出带路径和参数名的错误：

- 未注册的路径。
- 缺少必填参数或传入额外参数。
- `number`、`boolean` 类型错误，以及 `NaN`、无穷大。
- 对象参数不是可 JSON 序列化的对象。
- 对非 tabBar 页面调用 `switchTab`，或给 `switchTab` 传 query。

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

插件会将该写法转换为 uni-app 页面 `defineProps`，并通过响应式 getter 解析参数。`query.id` 为 `number`，`query.preview` 为 `boolean | undefined`；返回值只读，访问时会执行与 `parseQuery` 相同的类型转换和运行期校验。

字段可通过 `format` 覆盖默认解析逻辑。函数接收 URL 解码后的字符串，返回值必须与声明的 `type` 一致，并会继续接受运行期校验：

```ts
const query = definePage({
  query: {
    id: { type: Number, format: value => Number(value) },
    preview: { type: Boolean, required: false, format: JSON.parse },
  },
})
```

`format` 可以是 `JSON.parse` 等函数引用，也可以是使用页面作用域变量的内联函数。它属于 `definePage` 页面 props 语法糖；独立的 `parseQuery` 仍使用内置解析规则。

返回值语法仅支持 `<script setup>` 中的单个命名变量声明，例如 `const query = definePage(...)`。普通 `<script>`、解构或多个变量声明仍需使用下面的 `onLoad` 方式。

### 解析 `onLoad` 参数

```ts
import { onLoad } from '@dcloudio/uni-app'
import { parseQuery } from '@blyou/uni-router'

onLoad(query => {
  const params = parseQuery('/pages/user/detail', query ?? {})
  params.id       // number
  params.preview  // boolean | undefined
})
```

根包直接导出 `navigateTo`、`redirectTo`、`reLaunch`、`switchTab` 和 `parseQuery`。路由清单在构建期生成到 `@blyou/uni-router/auto-routes`，运行时由根包直接引用，无需手动注册。需要读取清单时可单独导入：

```ts
import { routes } from '@blyou/uni-router/auto-routes'
```

## 支持的页面配置

`definePage` 严格限制为以下七个字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `homepage` | `boolean` | 是否设为 uni-app 启动首页，只控制 `pages` 顺序。 |
| `ifdef` | `ConditionalPlatform[]` | 仅在指定平台参与编译，写入 `pages.json` 条件编译注释。 |
| `ifndef` | `ConditionalPlatform[]` | 在指定平台不参与编译，写入 `pages.json` 条件编译注释。 |
| `needLogin` | `boolean` | 页面是否需要登录。 |
| `style` | `GlobalStyle` | 页面窗口配置，写入 `pages.json`。 |
| `tabBar` | `UserTabBarItem` | 页面在底部 tabBar 中的配置，写入根 `tabBar.list`。 |
| `query` | query schema | 页面参数声明。 |

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

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `compilerSfc` | `string` | `'@vue/compiler-sfc'` | 从项目根目录解析的 SFC 编译器模块名或路径，优先使用宿主环境版本。 |
| `srcDir` | `string` | `'src'` | uni-app 源码目录，页面运行路径以它为基准。 |
| `dirs` | `Array<string \| RouteDirOptions>` | `['<srcDir>/pages']` | 一个或多个页面扫描目录。 |
| `include` | `string[]` | `['**/*.vue']` | 全局 include，可被目录配置覆盖。 |
| `exclude` | `string[]` | `[]` | 全局 exclude，可被目录配置覆盖。 |
| `pagesJson` | `string` | `'<srcDir>/pages.json'` | `pages.json` 路径。 |
| `dts` | `string \| false` | `'<root>/uni-router.d.ts'` | RouteMap 声明路径；设为 `false` 可关闭。 |
| `defaultMeta` | `PageMeta` | `{}` | 页面默认元信息；`style` 与页面配置合并，其他字段由页面覆盖。 |
| `sort` | `(a, b) => number` | 内置排序 | 自定义页面排序，参数包含 `path`、`file`、`subPackage` 等。 |
| `merge` | `boolean` | `true` | 是否保留受管范围外的既有页面及既有 tabBar 项。 |
| `watch` | `boolean` | `true` | 是否在开发/watch 模式同步页面增删改。 |

未提供 `sort` 时，默认优先 `pages/index/index`、`pages/index`，其余按路径排序；增量模式下会保留仍然有效的原启动页。提供 `sort` 后，以自定义结果为准。`homepage: true` 的页面优先于以上所有规则，始终排在 `pages` 第一位，其余页面再按 `sort` 或默认规则排序。

### 分包

```ts
UniRouter({
  dirs: [
    'src/pages',
    { src: 'src/subpackages/shop', subPackage: true },
  ],
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
