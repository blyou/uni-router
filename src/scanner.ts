import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { parse as parseBabel } from '@babel/parser'
import type {
  CallExpression,
  ImportDeclaration,
  Node,
  ObjectProperty,
} from '@babel/types'
import { glob } from 'tinyglobby'
import type { UserTabBarItem } from '@uni-helper/uni-pages-types'
import { fallbackSfcParser, loadSfcParser } from './sfc'
import type { SfcParser } from './sfc'
import type {
  NormalizedQuerySchema,
  PageMeta,
  RouteDirOptions,
  RouteFileInfo,
  RouteQueryValue,
  UniRouterOptions,
} from './types'

const runtimeModule = '@blyou/uni-router'
const constructors: Record<string, RouteQueryValue> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Object: 'object',
}

interface SourceRange {
  start: number
  end: number
}

interface MacroImport extends SourceRange {
  specifiers: SourceRange[]
  removeAll: boolean
}

export interface MacroCall extends SourceRange {
  propsVariable?: string
}

export interface PageMacroAnalysis {
  calls: MacroCall[]
  imports: MacroImport[]
  meta?: PageMeta
  query?: NormalizedQuerySchema
  formats?: Record<string, string>
  queryTypes?: Record<string, string>
  tabBar?: UserTabBarItem
  ifdef?: string[]
  ifndef?: string[]
  homepage?: boolean
}

export interface ResolvedRouteDir extends Required<Pick<RouteDirOptions, 'include' | 'exclude'>> {
  src: string
  base: string
  subPackage: boolean
}

export interface ResolvedUniRouterOptions {
  root: string
  compilerSfc: string
  srcDir: string
  dirs: ResolvedRouteDir[]
  pagesJson: string
  dts: string | false
  defaultMeta: PageMeta
  sort?: UniRouterOptions['sort']
  merge: boolean
  watch: boolean
}

export interface RouteManifest {
  routes: RouteFileInfo[]
  managedMainRoots: string[]
  managedSubPackageRoots: string[]
  excludedPaths: string[]
}

export function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function resolveOptions(options: UniRouterOptions = {}, root = process.cwd()): ResolvedUniRouterOptions {
  const resolvedRoot = resolve(root)
  const srcDir = resolve(resolvedRoot, options.srcDir ?? 'src')
  const dirs = options.dirs ?? [options.srcDir ? `${options.srcDir}/pages` : 'src/pages']
  const resolvedDirs = dirs.map(dir => {
    const value = typeof dir === 'string' ? { src: dir } : dir
    const absoluteSrc = resolve(resolvedRoot, value.src)
    const base = normalizePath(relative(srcDir, absoluteSrc))
    if (!base || base === '..' || base.startsWith('../') || isAbsolute(base)) {
      if (value.subPackage || base === '..' || base.startsWith('../') || isAbsolute(base)) {
        throw new Error(`[uni-router] Scan directory must be inside srcDir: ${value.src}`)
      }
    }
    if (value.subPackage && !base) {
      throw new Error('[uni-router] srcDir itself cannot be a subPackage root')
    }
    return {
      src: absoluteSrc,
      base,
      subPackage: value.subPackage ?? false,
      include: value.include ?? options.include ?? ['**/*.vue'],
      exclude: value.exclude ?? options.exclude ?? [],
    }
  })

  return {
    root: resolvedRoot,
    compilerSfc: options.compilerSfc ?? '@vue/compiler-sfc',
    srcDir,
    dirs: resolvedDirs,
    pagesJson: resolve(resolvedRoot, options.pagesJson ?? resolve(srcDir, 'pages.json')),
    dts: options.dts === false ? false : resolve(resolvedRoot, options.dts ?? 'uni-router.d.ts'),
    defaultMeta: options.defaultMeta ?? {},
    sort: options.sort,
    merge: options.merge ?? true,
    watch: options.watch ?? true,
  }
}

function location(file: string, node?: Node | null) {
  const position = node?.loc?.start
  return position ? `${file}:${position.line}:${position.column + 1}` : file
}

function fail(file: string, node: Node | null | undefined, message: string): never {
  throw new Error(`[uni-router] ${location(file, node)}: ${message}`)
}

function propertyKey(node: ObjectProperty, file: string) {
  if (node.computed) fail(file, node, 'Computed route config keys are not supported')
  if (node.key.type === 'Identifier') return node.key.name
  if (node.key.type === 'StringLiteral' || node.key.type === 'NumericLiteral') return String(node.key.value)
  return fail(file, node, 'Unsupported route config key')
}

function unwrap(node: Node): Node {
  if (
    node.type === 'TSAsExpression'
    || node.type === 'TSSatisfiesExpression'
    || node.type === 'TSTypeAssertion'
    || node.type === 'ParenthesizedExpression'
  ) return unwrap(node.expression)
  return node
}

function literal(node: Node, file: string): unknown {
  const value = unwrap(node)
  switch (value.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return value.value
    case 'NullLiteral':
      return null
    case 'UnaryExpression':
      if (value.operator === '-' && value.argument.type === 'NumericLiteral') return -value.argument.value
      break
    case 'ArrayExpression':
      return value.elements.map(element => {
        if (!element || element.type === 'SpreadElement') fail(file, element, 'Spread and empty array items are not supported')
        return literal(element, file)
      })
    case 'ObjectExpression': {
      const result: Record<string, unknown> = {}
      for (const property of value.properties) {
        if (property.type !== 'ObjectProperty') fail(file, property, 'Spread route config is not supported')
        const key = propertyKey(property, file)
        if (Object.hasOwn(result, key)) fail(file, property, `Duplicate config key "${key}"`)
        result[key] = literal(property.value, file)
      }
      return result
    }
  }
  return fail(file, value, 'Route config must be a static literal')
}

function queryType(node: Node, file: string): RouteQueryValue {
  const value = unwrap(node)
  if (value.type === 'Identifier' && constructors[value.name]) return constructors[value.name]
  return fail(file, value, 'Query type must be String, Number, Boolean, or Object')
}

function queryDeclaration(node: Node, script: string) {
  if (node.type !== 'TSAsExpression'
    || node.expression.type !== 'Identifier'
    || node.expression.name !== 'Object'
    || node.typeAnnotation.type !== 'TSTypeReference'
    || node.typeAnnotation.typeName.type !== 'Identifier'
    || node.typeAnnotation.typeName.name !== 'QueryType') return
  const parameters = node.typeAnnotation.typeParameters?.params
  if (parameters?.length === 1) {
    return script.slice(parameters[0].start ?? 0, parameters[0].end ?? 0)
  }
}

function queryFormatter(node: Node, file: string, script: string) {
  const value = unwrap(node)
  if (value.type !== 'Identifier'
    && value.type !== 'MemberExpression'
    && value.type !== 'FunctionExpression'
    && value.type !== 'ArrowFunctionExpression') {
    fail(file, value, 'format must be a function reference or function expression')
  }
  return script.slice(value.start ?? 0, value.end ?? 0)
}

function querySchema(
  node: Node,
  file: string,
  script: string,
  formats: Record<string, string>,
  queryTypes: Record<string, string>,
): NormalizedQuerySchema {
  const value = unwrap(node)
  if (value.type !== 'ObjectExpression') return fail(file, value, 'query must be a static object')
  const schema: NormalizedQuerySchema = {}
  for (const property of value.properties) {
    if (property.type !== 'ObjectProperty') fail(file, property, 'Spread query config is not supported')
    const name = propertyKey(property, file)
    if (Object.hasOwn(schema, name)) fail(file, property, `Duplicate query parameter "${name}"`)
    const field = unwrap(property.value)
    if (field.type === 'Identifier') {
      schema[name] = { type: queryType(field, file), required: true }
      continue
    }
    if (field.type !== 'ObjectExpression') fail(file, field, 'Query field must be a constructor or config object')
    let type: RouteQueryValue | undefined
    let required = true
    for (const option of field.properties) {
      if (option.type !== 'ObjectProperty') fail(file, option, 'Spread query field config is not supported')
      const key = propertyKey(option, file)
      if (key === 'type') {
        type = queryType(option.value, file)
        const declaration = queryDeclaration(option.value, script)
        if (declaration) queryTypes[name] = declaration
      }
      else if (key === 'required') {
        const requiredValue = unwrap(option.value)
        if (requiredValue.type !== 'BooleanLiteral') fail(file, requiredValue, 'required must be a boolean literal')
        required = requiredValue.value
      }
      else if (key === 'format') formats[name] = queryFormatter(option.value, file, script)
      else fail(file, option, `Unknown query field option "${key}"`)
    }
    if (!type) fail(file, field, `Query parameter "${name}" is missing type`)
    schema[name] = { type, required }
  }
  return schema
}

function normalizePlatform(value: string) {
  return value.trim().replace(/_/g, '-').toUpperCase()
}

function platformList(node: Node, file: string, name: string): string[] {
  const value = literal(node, file)
  if (!Array.isArray(value) || !value.length) {
    fail(file, node, `${name} must be a non-empty array of platform strings`)
  }
  const platforms = value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) {
      fail(file, node, `${name} must contain non-empty platform strings`)
    }
    return normalizePlatform(item)
  })
  return [...new Set(platforms)]
}

function pageDefinition(node: Node, file: string, script: string) {
  const value = unwrap(node)
  if (value.type !== 'ObjectExpression') return fail(file, value, 'definePage expects a static object')
  const meta: Record<string, unknown> = {}
  let query: NormalizedQuerySchema = {}
  const formats: Record<string, string> = {}
  const queryTypes: Record<string, string> = {}
  let tabBar: UserTabBarItem | undefined
  let ifdef: string[] | undefined
  let ifndef: string[] | undefined
  let homepage: boolean | undefined
  for (const property of value.properties) {
    if (property.type !== 'ObjectProperty') fail(file, property, 'Spread definePage config is not supported')
    const key = propertyKey(property, file)
    if (key === 'path') fail(file, property, 'path is managed outside definePage')
    if (key === 'query') query = querySchema(property.value, file, script, formats, queryTypes)
    else if (key === 'ifdef') ifdef = platformList(property.value, file, 'ifdef')
    else if (key === 'ifndef') ifndef = platformList(property.value, file, 'ifndef')
    else if (key === 'homepage') {
      const value = unwrap(property.value)
      if (value.type !== 'BooleanLiteral') fail(file, value, 'homepage must be a boolean literal')
      homepage = value.value
    }
    else if (key === 'tabBar') {
      const value = literal(property.value, file)
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail(file, property, 'tabBar must be a static object')
      }
      tabBar = value as UserTabBarItem
    }
    else meta[key] = literal(property.value, file)
  }
  return { meta: meta as PageMeta, query, formats, queryTypes, tabBar, ifdef, ifndef, homepage }
}

function importedMacros(body: Node[], file: string, offset: number) {
  const locals = new Set<string>(['definePage'])
  const imports: MacroImport[] = []
  for (const statement of body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== runtimeModule) continue
    const declaration = statement as ImportDeclaration
    const specifiers = declaration.specifiers.filter(specifier =>
      specifier.type === 'ImportSpecifier'
      && specifier.imported.type === 'Identifier'
      && specifier.imported.name === 'definePage'
      && declaration.importKind !== 'type'
      && specifier.importKind !== 'type',
    )
    if (!specifiers.length) continue
    for (const specifier of specifiers) locals.add(specifier.local.name)
    imports.push({
      start: offset + (declaration.start ?? 0),
      end: offset + (declaration.end ?? 0),
      specifiers: specifiers.map(specifier => ({
        start: offset + (specifier.start ?? 0),
        end: offset + (specifier.end ?? 0),
      })),
      removeAll: declaration.specifiers.length === specifiers.length,
    })
  }
  return { locals, imports }
}

function analyzeScript(script: string, file: string, offset: number, scriptSetup: boolean): PageMacroAnalysis {
  const ast = parseBabel(script, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })
  const body = ast.program.body as Node[]
  const { locals, imports } = importedMacros(body, file, offset)
  const calls: CallExpression[] = []
  const propsCalls = new Map<CallExpression, MacroCall>()
  for (const statement of body) {
    if (statement.type === 'ExpressionStatement') {
      const expression = statement.expression
      if (expression.type === 'CallExpression'
        && expression.callee.type === 'Identifier'
        && locals.has(expression.callee.name)) calls.push(expression)
      continue
    }
    if (statement.type !== 'VariableDeclaration') continue
    for (const declarator of statement.declarations) {
      const expression = declarator.init
      if (expression?.type !== 'CallExpression'
        || expression.callee.type !== 'Identifier'
        || !locals.has(expression.callee.name)) continue
      if (!scriptSetup) fail(file, expression, 'definePage return value requires <script setup>')
      if (statement.declarations.length !== 1 || declarator.id.type !== 'Identifier') {
        fail(file, declarator, 'definePage return value must use a single named variable')
      }
      calls.push(expression)
      propsCalls.set(expression, {
        start: offset + (statement.start ?? 0),
        end: offset + (statement.end ?? 0),
        propsVariable: declarator.id.name,
      })
    }
  }
  if (calls.length > 1) fail(file, calls[1], 'Only one definePage call is allowed per script block')
  const call = calls[0]
  let definition: ReturnType<typeof pageDefinition> | undefined
  if (call) {
    if (call.arguments.length !== 1 || call.arguments[0].type === 'SpreadElement' || call.arguments[0].type === 'ArgumentPlaceholder') {
      fail(file, call, 'definePage expects exactly one object argument')
    }
    definition = pageDefinition(call.arguments[0], file, script)
  }
  return {
    calls: calls.map(item => propsCalls.get(item) ?? {
      start: offset + (item.start ?? 0),
      end: offset + (item.end ?? 0),
    }),
    imports: call ? imports : [],
    ...definition,
  }
}

export function analyzePage(
  source: string,
  file: string,
  parseSfc: SfcParser = fallbackSfcParser(),
): PageMacroAnalysis {
  const { descriptor, errors } = parseSfc(source, { filename: file })
  if (errors.length) throw new Error(`[uni-router] ${file}: ${errors[0].message}`)
  const blocks = [descriptor.script, descriptor.scriptSetup].filter(block => block != null)
  const analyses = blocks.map(block => {
    const searchFrom = block.loc.start.offset ?? 0
    const contentOffset = source.indexOf(block.content, searchFrom)
    const offset = contentOffset >= 0 ? contentOffset : source.indexOf(block.content)
    return analyzeScript(block.content, file, Math.max(offset, 0), Boolean(block.setup))
  })
  const calls = analyses.flatMap(item => item.calls)
  if (calls.length > 1) throw new Error(`[uni-router] ${file}: Only one definePage call is allowed per page`)
  const withDefinition = analyses.find(item => item.calls.length)
  return {
    calls,
    imports: analyses.flatMap(item => item.imports),
    meta: withDefinition?.meta,
    query: withDefinition?.query,
    formats: withDefinition?.formats,
    queryTypes: withDefinition?.queryTypes,
    tabBar: withDefinition?.tabBar,
    ifdef: withDefinition?.ifdef,
    ifndef: withDefinition?.ifndef,
    homepage: withDefinition?.homepage,
  }
}

function withoutExtension(path: string) {
  const extension = extname(path)
  return normalizePath(path.slice(0, extension ? -extension.length : undefined))
}

function mergeMeta(defaults: PageMeta, meta: PageMeta): PageMeta {
  const merged = { ...defaults, ...meta }
  if (defaults.style || meta.style) merged.style = { ...defaults.style, ...meta.style }
  return merged
}

function defaultSort(a: RouteFileInfo, b: RouteFileInfo) {
  const rank = (path: string) => path === 'pages/index/index' ? 0 : path === 'pages/index' ? 1 : 2
  return rank(a.path) - rank(b.path) || a.path.localeCompare(b.path)
}

export async function scanPages(options: ResolvedUniRouterOptions): Promise<RouteManifest> {
  const parseSfc = await loadSfcParser(options.root, options.compilerSfc)
  const routes: RouteFileInfo[] = []
  const excludedPaths: string[] = []
  const seen = new Map<string, string>()

  for (const dir of options.dirs) {
    const allFiles = await glob(dir.include, { cwd: dir.src, onlyFiles: true, dot: false })
    const files = dir.exclude.length
      ? await glob(dir.include, { cwd: dir.src, onlyFiles: true, dot: false, ignore: dir.exclude })
      : allFiles
    const included = new Set(files.map(normalizePath))

    for (const relativeFile of allFiles.map(normalizePath).sort()) {
      const absoluteFile = resolve(dir.src, relativeFile)
      const fullPath = withoutExtension(relative(options.srcDir, absoluteFile))
      if (!fullPath || fullPath === '..' || fullPath.startsWith('../') || isAbsolute(fullPath)) {
        throw new Error(`[uni-router] Page must be inside srcDir: ${absoluteFile}`)
      }
      if (!included.has(relativeFile)) {
        excludedPaths.push(fullPath)
        continue
      }
      const previous = seen.get(fullPath)
      if (previous) throw new Error(`[uni-router] Duplicate page "${fullPath}" in ${previous} and ${absoluteFile}`)
      seen.set(fullPath, absoluteFile)

      const source = await readFile(absoluteFile, 'utf8')
      const analysis = analyzePage(source, absoluteFile, parseSfc)
      const meta = mergeMeta(options.defaultMeta, analysis.meta ?? {})
      const subPackage = dir.subPackage ? dir.base : undefined
      const pagePath = subPackage ? withoutExtension(relativeFile) : fullPath
      const file = normalizePath(relative(options.root, absoluteFile))
      if (subPackage && analysis.tabBar) {
        throw new Error(`[uni-router] ${file}: tabBar pages must be in the main package`)
      }
      routes.push({
        file,
        path: fullPath,
        page: { ...meta, path: pagePath },
        meta,
        query: analysis.query ?? {},
        queryTypes: analysis.queryTypes,
        tabBar: analysis.tabBar,
        ifdef: analysis.ifdef,
        ifndef: analysis.ifndef,
        homepage: analysis.homepage,
        subPackage,
      })
    }
  }

  const homepages = routes.filter(route => route.homepage === true)
  if (homepages.length > 1) {
    throw new Error(
      `[uni-router] Multiple homepage pages are not allowed: ${homepages.map(route => route.file).join(', ')}`,
    )
  }
  const homepage = homepages[0]
  if (homepage?.subPackage) {
    throw new Error(`[uni-router] ${homepage.file}: homepage pages must be in the main package`)
  }
  const sorted = routes.filter(route => route !== homepage)
  sorted.sort(options.sort ?? defaultSort)
  if (homepage) sorted.unshift(homepage)
  return {
    routes: sorted,
    managedMainRoots: options.dirs.filter(dir => !dir.subPackage).map(dir => dir.base),
    managedSubPackageRoots: options.dirs.filter(dir => dir.subPackage).map(dir => dir.base),
    excludedPaths,
  }
}
