# uni-app 文件系统路由自动生成实施计划

## 1. 概要

将当前占位 Vite 插件实现为一套完整的 uni-app 文件系统路由工具：

- 扫描指定页面目录，按真实文件路径生成并同步 `pages.json`。
- 通过 `definePage` 声明页面元配置和 query schema，完整复用 `@uni-helper/uni-pages-types` 的 `PagesConfig`、`PageMetaDatum`、`UserPageMeta`、`SubPackage` 等类型。
- 生成路由声明文件和 `virtual:uni-router` 虚拟模块，提供逐页面路径、参数、元信息类型。
- 提供 `navigateTo`、`redirectTo`、`reLaunch`、`switchTab` 与 `parseQuery` 运行期 API；统一编码、检查并解析参数。
- 默认增量合并现有配置，保留非受管页面及 `globalStyle`、`tabBar`、`easycom`、平台专有字段等配置。
- 构建、开发、新增/删除页面、修改宏及 HMR 时使用同一份路由清单，运行期代码不依赖 Node、DOM 或平台专有 API。

## 2. 当前状态与参考结论

### 当前项目

- [src/index.ts](file:///d:/Project/@blyou/uni-router/src/index.ts#L1-L15) 仅在 `transform` 中把 `.vue` 绝对路径去掉扩展名，再将 JSON 字符串追加到 SFC；没有目录扫描、合法路径转换、`pages.json` 写入、声明生成或运行期 API。
- [package.json](file:///d:/Project/@blyou/uni-router/package.json#L41-L43) 已直接依赖 `@uni-helper/uni-pages-types@^0.4.9`，锁文件已解析到 0.4.9。
- 已安装类型包实际导出 `PagesConfig`、`PageMetaDatum`、`UserPageMeta`、`SubPackage`、`GlobalStyle` 等；其中 `UserPageMeta` 支持页面配置增强，`definePage` 只有类型声明，运行时 JS 没有对应实现，因此本包需要自己的宏声明/空实现及编译期移除逻辑。
- [playground/src/pages.json](file:///d:/Project/@blyou/uni-router/playground/src/pages.json#L1-L16) 含 JSONC 注释，不能直接 `JSON.parse` 后整体覆盖。
- [playground/vite.config.ts](file:///d:/Project/@blyou/uni-router/playground/vite.config.ts#L1-L7) 目前只注册 `uni()`；[playground/src/pages/index/index.vue](file:///d:/Project/@blyou/uni-router/playground/src/pages/index/index.vue#L1-L41) 可作为导航示例入口。
- [tests/index.test.ts](file:///d:/Project/@blyou/uni-router/tests/index.test.ts#L1-L5) 仍是占位测试；[tsdown.config.ts](file:///d:/Project/@blyou/uni-router/tsdown.config.ts#L1-L10) 已配置 ESM/CJS 和声明构建。

### 参考边界

- `vuejs/router` 核心仓库本身不负责文件扫描；本方案借鉴其官方相关文件路由工具的理念：文件即路由记录、构建期生成 RouteMap、虚拟模块和类型增强。
- 不照搬 Vue Router 的嵌套路由、`children`、`:id`、catch-all 或 Web History。uni-app 页面是由 `pages.json` 注册的扁平物理页面。
- `src/pages/users/index.vue` 必须生成 `pages/users/index`，不能像 Vue Router 一样折叠成 `pages/users`；`[id]` 在本方案中没有动态路径语义。
- 动态信息统一通过 `?id=...` 传递，参数类型来自用户已选择的 `definePage` 显式 query 声明。

参考：
- https://github.com/vuejs/router/
- https://uvr.esm.is/guide/file-based-routing.html
- https://uvr.esm.is/guide/typescript.html
- https://uniapp.dcloud.net.cn/collocation/pages.html

## 3. 公共 API 与固定规则

### 3.1 插件配置

新增 `UniRouterOptions`，默认值如下：

| 配置 | 类型与默认值 | 规则 |
| --- | --- | --- |
| `srcDir` | `string`，默认 `'src'` | 页面物理路径和 `pages.json` path 的公共根目录。 |
| `dirs` | `Array<string \| RouteDirOptions>`，默认 `['src/pages']` | 支持多个主包/分包扫描目录。 |
| `include` | `string[]`，默认 `['**/*.vue']` | 全局扫描 glob；可被单目录配置覆盖。 |
| `exclude` | `string[]`，默认 `[]` | 排除的文件不自动生成；merge 时对应既有条目可作为手工页保留。 |
| `pagesJson` | `string`，默认 `'<srcDir>/pages.json'` | 支持 JSONC，不存在时创建。 |
| `dts` | `string \| false`，默认 `'<srcDir>/uni-router.d.ts'` | 设为 `false` 可关闭项目声明生成，不推荐。 |
| `defaultMeta` | `PageMeta`，默认 `{}` | 页面默认元配置；普通字段浅合并，`style` 深合并一层，页面值优先，不继承 query。 |
| `sort` | `(a: RouteFileInfo, b: RouteFileInfo) => number` | 可选自定义受管页面排序。 |
| `merge` | `boolean`，默认 `true` | 保留非受管页面和分包；`false` 时只替换 `pages`/`subPackages`，仍保留其他根字段。 |
| `watch` | `boolean`，默认 `true` | 开发时监听页面新增、删除和修改。 |

`RouteDirOptions` 固定为：

```ts
{
  src: string
  include?: string[]
  exclude?: string[]
  subPackage?: boolean
}
```

- `subPackage: true` 时，以该目录相对 `srcDir` 的路径作为 `SubPackage.root`，包内页面 path 相对 root。
- 默认排序为 `pages/index/index`、`pages/index` 优先，其余按规范化 path 做稳定字符串排序；显式 `sort` 完全接管受管页面顺序。
- merge 且未提供 `sort` 时，保留仍然有效的原启动页为第一项，避免迁移改变首页。

### 3.2 路径与扫描规则

- 扫描结果统一转为 POSIX `/`，去除 Windows 盘符、查询串和扩展名；拒绝把绝对文件路径写入 `pages.json`。
- 主包 path 为文件相对 `srcDir` 的无扩展名路径，写入时不加 `/`；运行期 RouteMap key 统一加前导 `/`。
- 分包生成 `SubPackage` 和相对页面 path，运行期完整路径为 `/${root}/${page.path}`。
- 不折叠 `index`，不解析动态段，不自动改变真实文件位置。
- 同一主包/分包出现重复 path、非法逃逸 `srcDir` 的 path、同一文件被多个目录重复管理时直接报错，并列出冲突文件。
- include 可扩展到 `.nvue`/`.uvue` 等 SFC 文件；默认仍只扫描 `.vue`，不在生成器中按 `UNI_PLATFORM` 写平台分支。

### 3.3 `definePage` 与 query DSL

页面从 `@blyou/uni-router/runtime` 显式导入 `definePage`。宏参数类型基于 `UserPageMeta`，但排除自动生成的 `path` 和本方案不接管的 `tabBar` 辅助字段；其余 style、`type`、`needLogin`、平台字段及通过接口增强的自定义元字段保持原类型。

```vue
<script setup lang="ts">
import { definePage } from '@blyou/uni-router/runtime'

definePage({
  style: {
    navigationBarTitleText: '用户详情',
    'mp-weixin': {
      navigationBarTitleText: '详情',
    },
  },
  needLogin: true,
  query: {
    id: String,
    page: { type: Number, required: false },
    preview: { type: Boolean, required: false },
  },
})
</script>
```

固定语义：

- `String`、`Number`、`Boolean` 简写表示必填参数；`{ type, required: false }` 表示可选参数，缺省 `required` 为 `true`。
- 生成类型分别为 `string`、`number`、`boolean`；上例 query 类型为 `{ id: string; page?: number; preview?: boolean }`。
- `query` 只进入运行期清单和声明文件，不写入 `pages.json`；其余页面元配置生成 `PageMetaDatum` 并保留在运行期只读路由清单中。
- 自定义业务元字段通过模块增强 `UserPageMeta` 获得校验，不另建一套与 uni-pages-types 平行、容易漂移的 pages 类型。
- 宏只接受可静态求值的配置：对象/数组、字符串、数字、布尔、null、负数、`as const`、`satisfies` 及 query 的三个构造器。变量、函数调用、计算属性、展开表达式和运行时条件编译不予猜测，报出文件与宏位置；这样不会执行项目代码，也不会生成不确定配置。
- 支持 `<script setup>` 和普通 `<script>`，每页最多一个 `definePage`。构建 transform 只移除宏调用及不再使用的宏导入，不再向 SFC 拼接 JSON；运行时空实现仅作为类型检查和安全兜底。

## 4. 具体文件改动

### 4.1 类型、扫描与宏解析

1. 新增 [src/types.ts](file:///d:/Project/@blyou/uni-router/src/types.ts)
   - 定义并导出 `UniRouterOptions`、`RouteDirOptions`、`RouteFileInfo`、`PageMeta`、`PageDefinition`、`QuerySchema`、`QueryField`、`RouteQueryValue`。
   - 从 `@uni-helper/uni-pages-types` 派生页面和配置类型；从生成的 `UniRouteMap` 派生 `RoutePath`、`RouteQuery<P>`、`TabRoutePath`、必填 query options。
   - 运行期 options 使用 `Omit<UniNamespace.NavigateToOptions, 'url'>` 等原生类型，保留 success/fail/complete、events、animation 等提示。

2. 新增 [src/scanner.ts](file:///d:/Project/@blyou/uni-router/src/scanner.ts)
   - 使用 glob 扫描和 include/exclude，过滤目录，统一路径大小写之外的字符与分隔符，不擅自改名。
   - 使用 `@vue/compiler-sfc` 提取 script，再用 `@babel/parser` 的 TypeScript 插件定位已导入的 `definePage`（含别名）并静态求值。
   - 输出包含真实 file、主/分包 path、合并后的 `PageMetaDatum`、query schema、运行期 meta 的不可变路由清单。
   - 对宏语法、query 构造器、重复路径、分包 root 做带文件上下文的诊断。

### 4.2 `pages.json`、声明及虚拟模块

3. 新增 [src/pages-json.ts](file:///d:/Project/@blyou/uni-router/src/pages-json.ts)
   - 用 `jsonc-parser` 读取/修改 JSONC，保留注释、根字段和非受管配置，避免整文件格式化覆盖。
   - 以 `PagesConfig`、`PageMetaDatum[]`、`SubPackage[]` 校验中间结果。
   - 仅在序列化结果变化时写入，并保持结尾换行与幂等；写入失败时不留下半文件。

4. 新增 [src/generator.ts](file:///d:/Project/@blyou/uni-router/src/generator.ts)
   - 由同一路由清单生成 `uni-router.d.ts` 和虚拟模块代码，防止 pages 配置、类型和运行时数据不一致。
   - 声明文件引用包内 client 类型，并增强 `@blyou/uni-router/runtime` 的 `UniRouteMap`：每页记录规范 path、精确 query、文件路径及 `UserPageMeta` 元信息类型。
   - 根据最终 `tabBar.list` 标记可 `switchTab` 的自动生成页；非自动生成手工页仍可继续使用原生 `uni.switchTab`。
   - 虚拟模块导出只读 `routes`，并通过 `createUniRouter(routes)` 导出绑定同一清单的 typed API。

5. 新增 [src/client.d.ts](file:///d:/Project/@blyou/uni-router/src/client.d.ts)
   - 声明 `virtual:uni-router` 的 `routes`、四个导航方法和 `parseQuery`。
   - 作为稳定基础声明随包发布；项目生成文件只补充具体 RouteMap，不复制整套运行期类型。

### 4.3 增量合并算法

在 `pages-json.ts` 中固定执行以下顺序：

1. 读取现有 JSONC；无文件时以 `{ pages: [] }` 开始。
2. 根据扫描目录推导受管主包前缀和分包 root。生成条目替换同 path 的受管旧条目。
3. 删除受管范围内已不存在且未 exclude 的旧条目，保证删文件后路由同步删除。
4. 保留范围外手工页面/分包，以及 exclude 对应的既有页面；保留其相对顺序和全部未知字段。
5. 合并受管 `SubPackage` 的 `pages`，保留既有 `plugins` 等分包扩展字段；未受管分包原样保留。
6. 应用默认/自定义排序；merge 默认保留有效原启动页。`merge: false` 时仅整体替换 `pages` 和 `subPackages`。
7. 保留 `globalStyle`、`tabBar`、`easycom`、`condition`、`preloadRule`、`leftWindow`、`topWindow`、`rightWindow`、`uniIdRouter`、平台专有及未知根字段。
8. 检查最终自动生成的 tabBar 页面引用；若配置引用了已被删除的受管页面，给出明确错误而不是静默生成不可启动配置。

### 4.4 运行期 API

6. 新增 [src/runtime.ts](file:///d:/Project/@blyou/uni-router/src/runtime.ts)
   - 只放跨端代码和 type-only imports，不导入 scanner、fs、path、Vite、Node 或 DOM API。
   - 导出宏空实现、路由/参数公共类型和 `createUniRouter(routes)`；虚拟模块负责绑定实际清单。
   - `navigateTo`、`redirectTo`、`reLaunch` 接收 `{ url: RoutePath, query?, ...原生options }`，手工拼接并 `encodeURIComponent` 编码参数，不依赖 `URL`/`URLSearchParams`。
   - 导航前校验路径、必填参数、参数种类和有限数字；`switchTab` 只接受 tab 路径且不接收 query。
   - `parseQuery(path, onLoadQuery)` 按同一路由 schema 检查必填项，把字符串转换为 string/number/boolean；非法 number/boolean 给出包含页面和参数名的错误。
   - 保留原生 API 调用方式和回调语义，不用 H5 History 模拟路由，不引入 Vue/React 依赖。

### 4.5 插件编排与 HMR

7. 重写 [src/index.ts](file:///d:/Project/@blyou/uni-router/src/index.ts)
   - 默认导出 `UniRouter(options)`，设置 `name` 和 `enforce: 'pre'`，文档要求放在 `uni()` 前。
   - 在 Vite `config` 阶段完成首次扫描和写入，确保 uni 插件后续读取到最新 `pages.json`；`buildStart` 再执行幂等同步，覆盖构建/watch 场景。
   - 用 `resolveId/load` 提供 `virtual:uni-router`，由 generator 返回当前清单代码。
   - `configureServer` 监听页面目录 add/unlink/change；`handleHotUpdate`/`watchChange` 处理宏、页面和手工 `pages.json` 修改。
   - 所有入口共用串行、去抖的 regenerate 流程；变更后失效虚拟模块并触发合理刷新。自写入通过内容比较避免无限循环。
   - transform 使用 `MagicString` 返回准确 sourcemap，只处理含目标宏的页面，其他文件原样返回。

## 5. 包配置、示例与文档

8. 更新 [package.json](file:///d:/Project/@blyou/uni-router/package.json)
   - 包名调整为 `@blyou/uni-router`，补充描述；导出 `.`、`./runtime` 和 types-only `./client`，为 ESM/CJS 配齐 types 条件。
   - 保留并严格使用 `@uni-helper/uni-pages-types`；新增直接构建期依赖 `@vue/compiler-sfc`、`@babel/parser`、`jsonc-parser`、`magic-string`、`tinyglobby`。
   - 增加 `vite` peer/dev 依赖与 `@dcloudio/types` 开发类型依赖，版本与 playground 的 Vite 5/uni-app 兼容；运行期不依赖这些构建期包。
   - 增加单元测试、类型测试所需的脚本，更新 lockfile。

9. 更新 [tsdown.config.ts](file:///d:/Project/@blyou/uni-router/tsdown.config.ts)
   - 配置 Node 插件入口和跨端 runtime 入口分别构建，确保 runtime 产物不含 Node 内置模块。
   - 输出声明并将 `client.d.ts` 纳入发布文件；保持现有 ESM/CJS 格式。

10. 更新 playground
    - [playground/package.json](file:///d:/Project/@blyou/uni-router/playground/package.json) 添加 `workspace:*` 包引用。
    - [playground/vite.config.ts](file:///d:/Project/@blyou/uni-router/playground/vite.config.ts) 在 `uni()` 前注册 `UniRouter()`。
    - 修改 [playground/src/pages/index/index.vue](file:///d:/Project/@blyou/uni-router/playground/src/pages/index/index.vue)，声明首页 meta 并演示 typed `navigateTo`。
    - 新增 `playground/src/pages/user/detail.vue`，演示 query schema、`onLoad` 与 `parseQuery`。
    - [playground/src/env.d.ts](file:///d:/Project/@blyou/uni-router/playground/src/env.d.ts) 引用 client 类型；现有 `src/**/*.d.ts` include 已能覆盖生成的 `uni-router.d.ts`。
    - 通过插件实际生成并检查 [playground/src/pages.json](file:///d:/Project/@blyou/uni-router/playground/src/pages.json) 与 `playground/src/uni-router.d.ts`，不手工维护两份结果。

11. 重写 [README.md](file:///d:/Project/@blyou/uni-router/README.md)
    - 提供安装、Vite 插件顺序、首次生成、tsconfig include、建议提交生成声明的说明。
    - 提供主包、分包、include/exclude、defaultMeta、sort、merge、关闭 dts 等配置示例和完整配置表。
    - 提供 definePage、自定义 `UserPageMeta` 模块增强、四种导航及 onLoad 参数解析示例。
    - 明确静态宏限制、物理路径/index 规则、增量迁移和删除语义、tabBar 限制、生成物及 HMR 行为。
    - 说明多端策略：相同清单用于 H5/App/各小程序；平台样式继续使用 uni-pages-types 已有平台字段；不引入 `:id`、Web History、Node/DOM API。

## 6. 测试与验证

### 自动化测试

将占位测试替换为实际测试，按职责拆分为 scanner、pages-json/generator、runtime 和类型测试：

- 扫描：嵌套/index、多个目录、include/exclude、Windows 分隔符、主/分包路径、重复路径、宏别名、默认 meta 合并、非法/动态宏诊断。
- JSONC：注释与未知根字段保留、手工页增量迁移、exclude 保留、文件删除、分包 plugins 保留、原启动页、自定义排序、重复执行零 diff。
- 生成物：pages、RouteMap、tab 路径和虚拟模块来自同一清单；路径无扩展名/盘符，query 不进入 pages.json。
- 运行时：URL 编码、必填/可选参数、string/number/boolean 序列化与解析、非法值、未知路径、switchTab 限制、原生 options/callbacks 透传。
- 类型：合法路径和 query 自动提示；错误路径、缺少必填参数、错误参数类型、switchTab 传 query 均通过 `@ts-expect-error`/`expectTypeOf` 验证。

### 命令验证

1. 根包执行单元测试、类型测试、`pnpm typecheck`、`pnpm build`，并检查 dist 的 exports、d.ts 和 runtime 不依赖 Node。
2. 在 playground 首次启动生成后，再执行一次构建确认 `pages.json` 和 `uni-router.d.ts` 无额外 diff。
3. 执行 playground `vue-tsc`，验证生成的 RouteMap 与虚拟模块在 Vue SFC 中生效。
4. 至少执行 H5、App、微信小程序构建；再用支付宝小程序构建覆盖另一小程序平台。四端均使用相同源页面和生成清单，不添加平台专用运行时代码。
5. 开发模式实测新增、修改、删除页面及只修改 definePage：配置/声明同步、虚拟模块失效、无重复写入或 watch 死循环。

## 7. 假设与明确不做事项

- 本方案是 uni-app 原生 `pages.json` 路由生成器，不引入 `vue-router`，也不提供嵌套路由、布局嵌套、动态 path 或前端路由守卫。
- `definePage` 的业务 meta 与 query 必须可静态序列化；需要平台差异时使用 pages.json 支持的平台字段，而非在宏内执行 JavaScript 条件逻辑。
- 默认只自动管理扫描范围内的页面；范围外手工路由保持原样，可继续调用原生 uni API，便于逐页迁移。
- 生成的 `uni-router.d.ts` 建议提交，保证编辑器、CI 和未启动 dev server 时也能获得稳定类型。
- 多端兼容指同一代码可编译到 uni-app 支持的平台；具体平台自身对分包、窗口、动画和 tabBar 的限制仍遵循 uni-app 官方规则。
