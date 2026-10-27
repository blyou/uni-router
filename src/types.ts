import type { PageMetaDatum, UserPageMeta, UserTabBarItem } from '@uni-helper/uni-pages-types'

export type ConditionalPlatformToken =
  | 'APP'
  | 'APP-ANDROID'
  | 'APP-HARMONY'
  | 'APP-IOS'
  | 'APP-NVUE'
  | 'APP-PLUS'
  | 'APP-PLUS-NVUE'
  | 'APP-UVUE'
  | 'APP-VUE'
  | 'H5'
  | 'MP'
  | 'MP-360'
  | 'MP-ALIPAY'
  | 'MP-BAIDU'
  | 'MP-HARMONY'
  | 'MP-JD'
  | 'MP-KUAISHOU'
  | 'MP-LARK'
  | 'MP-QQ'
  | 'MP-TOUTIAO'
  | 'MP-WEIXIN'
  | 'MP-XHS'
  | 'QUICKAPP-NATIVE'
  | 'QUICKAPP-WEBVIEW'
  | 'QUICKAPP-WEBVIEW-HUAWEI'
  | 'QUICKAPP-WEBVIEW-UNION'
  | 'UNI-APP-X'
  | 'VUE2'
  | 'VUE3'
  | 'WEB'
type UnderscorePlatform<T extends string> = T extends `${infer Head}-${infer Tail}`
  ? `${Head}_${UnderscorePlatform<Tail>}`
  : T
export type ConditionalPlatform =
  | ConditionalPlatformToken
  | Lowercase<ConditionalPlatformToken>
  | UnderscorePlatform<ConditionalPlatformToken>
  | Lowercase<UnderscorePlatform<ConditionalPlatformToken>>

export type QueryType<T> = ObjectConstructor & { readonly __queryType: T }
export type QueryConstructor = StringConstructor | NumberConstructor | BooleanConstructor | ObjectConstructor
export type QueryFormatter<T> = (value: string) => T
export type QueryField<C extends QueryConstructor = QueryConstructor> = C | {
  /** 参数类型构造器，如 `String`、`Number`、`Boolean` 或 `Object as QueryType<T>` */
  type: C
  /** 是否必填，默认 `true` */
  required?: boolean
  /** 自定义解析函数，接收 URL 解码后的字符串，返回值需与 `type` 一致 */
  format?: QueryFormatter<ConstructorValue<C>>
}
export type QuerySchema = Record<string, QueryField>
export type RouteQueryValue = 'string' | 'number' | 'boolean' | 'object'

export interface NormalizedQueryField {
  type: RouteQueryValue
  required: boolean
  format?: QueryFormatter<unknown>
}

export type NormalizedQuerySchema = Record<string, NormalizedQueryField>
export type PageMeta = UserPageMeta & {
  path?: never
  tabBar?: never
  homepage?: never
}
export type PageDefinition<Q extends QuerySchema = Record<never, never>> = Pick<
  UserPageMeta,
  'needLogin' | 'style' | 'tabBar'
> & {
  /** 是否将该页面设为 uni-app 启动首页；有且仅能有一个页面设置 */
  homepage?: boolean
  /** 仅在指定平台参与编译，值使用 uni-app 条件编译平台标识 */
  ifdef?: ConditionalPlatform[]
  /** 在指定平台不参与编译，值使用 uni-app 条件编译平台标识 */
  ifndef?: ConditionalPlatform[]
  /** 页面参数 schema；导航时据此校验，页面中据此解析 */
  query?: Q
}

type ConstructorValue<C extends QueryConstructor> = C extends { readonly __queryType: infer T }
  ? T
  : C extends StringConstructor
    ? string
    : C extends NumberConstructor
      ? number
      : C extends BooleanConstructor
        ? boolean
        : Record<string, unknown>
type QueryFieldValue<F extends QueryField> = F extends QueryConstructor
  ? ConstructorValue<F>
  : F extends { type: infer C extends QueryConstructor }
    ? ConstructorValue<C>
    : never
type RequiredPageQueryKeys<Q extends QuerySchema> = {
  [K in keyof Q]: Q[K] extends { required: false } ? never : K
}[keyof Q]
type OptionalPageQueryKeys<Q extends QuerySchema> = {
  [K in keyof Q]: Q[K] extends { required: false } ? K : never
}[keyof Q]

export type PageQuery<Q extends QuerySchema> = Readonly<{
  [K in RequiredPageQueryKeys<Q>]: QueryFieldValue<Q[K]>
} & {
  [K in OptionalPageQueryKeys<Q>]?: QueryFieldValue<Q[K]>
}>

export interface RouteDirOptions {
  /** 页面扫描目录，相对于项目根目录，且必须位于 `srcDir` 内 */
  src: string
  /** 该目录的扫描规则，优先于全局 `include`，默认匹配所有 `.vue` 文件 */
  include?: string[]
  /** 该目录的排除规则，优先于全局 `exclude`，默认 `[]` */
  exclude?: string[]
  /** 是否将该目录下的页面写入 `subPackages`，默认 `false` */
  subPackage?: boolean
}

export interface RouteFileInfo {
  file: string
  path: string
  page: PageMetaDatum
  meta: PageMeta
  query: NormalizedQuerySchema
  queryTypes?: Record<string, string>
  /** 页面级 tabBar 配置，会合并到根 `tabBar.list` */
  tabBar?: UserTabBarItem
  /** 仅在指定平台参与编译 */
  ifdef?: string[]
  /** 在指定平台不参与编译 */
  ifndef?: string[]
  /** 是否为 uni-app 启动首页，只控制 `pages` 顺序 */
  homepage?: boolean
  subPackage?: string
}

export interface UniRouterOptions {
  /** 指定 `@vue/compiler-sfc` 的模块名或路径，从项目根目录解析，默认 `'@vue/compiler-sfc'` */
  compilerSfc?: string
  /** uni-app 源码目录，相对于项目根目录，默认 `'src'` */
  srcDir?: string
  /** 一个或多个页面扫描目录，默认 `['<srcDir>/pages']` */
  dirs?: Array<string | RouteDirOptions>
  /** 全局扫描规则，可被目录配置覆盖，默认匹配所有 `.vue` 文件 */
  include?: string[]
  /** 全局排除规则，可被目录配置覆盖，默认 `[]` */
  exclude?: string[]
  /** `pages.json` 路径，相对于项目根目录，默认 `'<srcDir>/pages.json'` */
  pagesJson?: string
  /** RouteMap 声明文件路径，相对于项目根目录，默认 `'uni-router.d.ts'`；设为 `false` 关闭生成 */
  dts?: string | false
  /** 页面默认元信息；`style` 与页面配置合并，其他字段可由页面覆盖，默认 `{}` */
  defaultMeta?: PageMeta
  /**
   * 自定义页面排序
   * @param a 前一个页面
   * @param b 后一个页面
   * @returns 负数表示 `a` 在前，正数表示 `b` 在前
   */
  sort?: (a: RouteFileInfo, b: RouteFileInfo) => number
  /** 是否保留受管范围外的既有页面，默认 `true` */
  merge?: boolean
  /** 是否在开发模式监听页面增删改并同步，默认 `true` */
  watch?: boolean
}

export interface UniRouteInfo {
  path: string
  file: string
  meta: PageMeta
  query: NormalizedQuerySchema
  tab: boolean
  subPackage?: string
}

export type { PageMetaDatum, PagesConfig, SubPackage, UserPageMeta } from '@uni-helper/uni-pages-types'
