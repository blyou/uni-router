import { parse as parseBabel } from '@babel/parser'
import type { CallExpression, ImportDeclaration, Node, ObjectProperty } from '@babel/types'
import type { UserTabBarItem } from '@uni-helper/uni-pages-types'
import { fallbackSfcParser } from './sfc'
import type { SfcParser } from './sfc'
import type { NormalizedQuerySchema, PageMeta, RouteQueryValue } from './types'
import { setOwn } from './utils'

export const runtimeModule = '@blyou/uni-router'

const constructors: Record<string, RouteQueryValue> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Object: 'object',
}

const underscoreRE = /_/g
const platformRE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const definePropsRE = /\bdefineProps\b/

interface SourceRange {
  start: number
  end: number
}

interface MacroImport extends SourceRange {
  specifiers: SourceRange[]
  removeAll: boolean
}

export interface MacroCall extends SourceRange {
  queryVariable?: string
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
  scriptSetupOffset?: number
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
  let key: string
  if (node.key.type === 'Identifier') key = node.key.name
  else if (node.key.type === 'StringLiteral' || node.key.type === 'NumericLiteral')
    key = String(node.key.value)
  else return fail(file, node, 'Unsupported route config key')
  if (key === '__proto__') fail(file, node, 'Config key "__proto__" is not supported')
  return key
}

function unwrap(node: Node): Node {
  if (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSTypeAssertion' ||
    node.type === 'ParenthesizedExpression'
  )
    return unwrap(node.expression)
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
      if (value.operator === '-' && value.argument.type === 'NumericLiteral')
        return -value.argument.value
      break
    case 'ArrayExpression':
      return value.elements.map(element => {
        if (!element || element.type === 'SpreadElement')
          fail(file, element, 'Spread and empty array items are not supported')
        return literal(element, file)
      })
    case 'ObjectExpression': {
      const result: Record<string, unknown> = {}
      for (const property of value.properties) {
        if (property.type !== 'ObjectProperty')
          fail(file, property, 'Spread route config is not supported')
        const key = propertyKey(property, file)
        if (Object.hasOwn(result, key)) fail(file, property, `Duplicate config key "${key}"`)
        setOwn(result, key, literal(property.value, file))
      }
      return result
    }
  }
  return fail(file, value, 'Route config must be a static literal')
}

function queryType(node: Node, file: string): RouteQueryValue {
  const value = unwrap(node)
  if (value.type === 'Identifier' && Object.hasOwn(constructors, value.name)) {
    return constructors[value.name]
  }
  return fail(file, value, 'Query type must be String, Number, Boolean, or Object')
}

function queryDeclaration(node: Node, script: string) {
  if (
    node.type !== 'TSAsExpression' ||
    node.expression.type !== 'Identifier' ||
    node.expression.name !== 'Object' ||
    node.typeAnnotation.type !== 'TSTypeReference' ||
    node.typeAnnotation.typeName.type !== 'Identifier' ||
    node.typeAnnotation.typeName.name !== 'QueryType'
  )
    return
  const parameters = node.typeAnnotation.typeParameters?.params
  if (parameters?.length !== 1) return
  const [parameter] = parameters
  if (parameter.start == null || parameter.end == null) return
  return script.slice(parameter.start, parameter.end)
}

function queryFormatter(node: Node, file: string, script: string) {
  const value = unwrap(node)
  if (
    value.type !== 'Identifier' &&
    value.type !== 'MemberExpression' &&
    value.type !== 'FunctionExpression' &&
    value.type !== 'ArrowFunctionExpression'
  ) {
    fail(file, value, 'format must be a function reference or function expression')
  }
  if (value.start == null || value.end == null)
    fail(file, value, 'format is not a static expression')
  return script.slice(value.start, value.end)
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
    if (property.type !== 'ObjectProperty')
      fail(file, property, 'Spread query config is not supported')
    const name = propertyKey(property, file)
    if (Object.hasOwn(schema, name)) fail(file, property, `Duplicate query parameter "${name}"`)
    const field = unwrap(property.value)
    if (field.type === 'Identifier') {
      setOwn(schema, name, { type: queryType(field, file), required: true })
      continue
    }
    if (field.type !== 'ObjectExpression')
      fail(file, field, 'Query field must be a constructor or config object')
    let type: RouteQueryValue | undefined
    let required = true
    const seen = new Set<string>()
    for (const option of field.properties) {
      if (option.type !== 'ObjectProperty')
        fail(file, option, 'Spread query field config is not supported')
      const key = propertyKey(option, file)
      if (seen.has(key)) fail(file, option, `Duplicate query field option "${key}"`)
      seen.add(key)
      if (key === 'type') {
        type = queryType(option.value, file)
        const declaration = queryDeclaration(option.value, script)
        if (declaration) setOwn(queryTypes, name, declaration)
      } else if (key === 'required') {
        const requiredValue = unwrap(option.value)
        if (requiredValue.type !== 'BooleanLiteral')
          fail(file, requiredValue, 'required must be a boolean literal')
        required = requiredValue.value
      } else if (key === 'format') setOwn(formats, name, queryFormatter(option.value, file, script))
      else fail(file, option, `Unknown query field option "${key}"`)
    }
    if (!type) fail(file, field, `Query parameter "${name}" is missing type`)
    setOwn(schema, name, { type, required })
  }
  return schema
}

// TypeScript 类型只接受大写规范值；这里为未类型化的 JS 页面保留防御性归一化。
function normalizePlatform(value: string) {
  return value.trim().replace(underscoreRE, '-').toUpperCase()
}

function platformList(node: Node, file: string, name: string): string[] {
  const value = literal(node, file)
  if (!Array.isArray(value) || !value.length) {
    fail(file, node, `${name} must be a non-empty array of platform strings`)
  }
  const platforms = value.map(item => {
    if (typeof item !== 'string' || !item.trim()) {
      fail(file, node, `${name} must contain non-empty platform strings`)
    }
    const platform = normalizePlatform(item)
    if (!platformRE.test(platform)) {
      fail(file, node, `${name} contains an unsupported platform "${item}"`)
    }
    return platform
  })
  return [...new Set(platforms)]
}

function staticObject(node: Node, file: string, name: string): Record<string, unknown> {
  const value = literal(node, file)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(file, node, `${name} must be a static object`)
  }
  return value as Record<string, unknown>
}

function pageDefinition(node: Node, file: string, script: string) {
  const value = unwrap(node)
  if (value.type !== 'ObjectExpression')
    return fail(file, value, 'definePage expects a static object')
  const meta: Record<string, unknown> = {}
  let query: NormalizedQuerySchema = {}
  const formats: Record<string, string> = {}
  const queryTypes: Record<string, string> = {}
  let tabBar: UserTabBarItem | undefined
  let ifdef: string[] | undefined
  let ifndef: string[] | undefined
  let homepage: boolean | undefined
  const seen = new Set<string>()
  for (const property of value.properties) {
    if (property.type !== 'ObjectProperty')
      fail(file, property, 'Spread definePage config is not supported')
    const key = propertyKey(property, file)
    if (seen.has(key)) fail(file, property, `Duplicate definePage option "${key}"`)
    seen.add(key)
    if (key === 'path') fail(file, property, 'path is managed outside definePage')
    if (key === 'query') query = querySchema(property.value, file, script, formats, queryTypes)
    else if (key === 'ifdef') ifdef = platformList(property.value, file, 'ifdef')
    else if (key === 'ifndef') ifndef = platformList(property.value, file, 'ifndef')
    else if (key === 'homepage') {
      const homepageValue = unwrap(property.value)
      if (homepageValue.type !== 'BooleanLiteral')
        fail(file, homepageValue, 'homepage must be a boolean literal')
      homepage = homepageValue.value
    } else if (key === 'needLogin') {
      const needLogin = unwrap(property.value)
      if (needLogin.type !== 'BooleanLiteral')
        fail(file, needLogin, 'needLogin must be a boolean literal')
      meta.needLogin = needLogin.value
    } else if (key === 'style') {
      meta.style = staticObject(property.value, file, 'style')
    } else if (key === 'tabBar') {
      const tabBarValue = staticObject(property.value, file, 'tabBar')
      if (
        tabBarValue.index !== undefined &&
        (typeof tabBarValue.index !== 'number' || !Number.isFinite(tabBarValue.index))
      ) {
        fail(file, property, 'tabBar.index must be a finite number')
      }
      tabBar = tabBarValue as UserTabBarItem
    } else fail(file, property, `Unknown definePage option "${key}"`)
  }
  return { meta: meta as PageMeta, query, formats, queryTypes, tabBar, ifdef, ifndef, homepage }
}

function importedMacros(body: Node[]) {
  const locals = new Set<string>(['definePage'])
  const imports: MacroImport[] = []
  for (const statement of body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== runtimeModule) continue
    const declaration = statement as ImportDeclaration
    const specifiers = declaration.specifiers.filter(
      specifier =>
        specifier.type === 'ImportSpecifier' &&
        specifier.imported.type === 'Identifier' &&
        specifier.imported.name === 'definePage' &&
        declaration.importKind !== 'type' &&
        specifier.importKind !== 'type',
    )
    if (!specifiers.length) continue
    for (const specifier of specifiers) locals.add(specifier.local.name)
    imports.push({
      start: declaration.start ?? 0,
      end: declaration.end ?? 0,
      specifiers: specifiers.map(specifier => ({
        start: specifier.start ?? 0,
        end: specifier.end ?? 0,
      })),
      removeAll: declaration.specifiers.length === specifiers.length,
    })
  }
  return { locals, imports }
}

function analyzeScript(script: string, file: string): PageMacroAnalysis {
  let ast
  try {
    ast = parseBabel(script, {
      sourceType: 'module',
      plugins: [
        'typescript',
        'jsx',
        'decorators-legacy',
        'explicitResourceManagement',
        'importAttributes',
      ],
    })
  } catch (error) {
    fail(
      file,
      null,
      `Cannot parse page script: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const body = ast.program.body as Node[]
  const { locals, imports } = importedMacros(body)
  const calls: CallExpression[] = []
  const queryCalls = new Map<CallExpression, MacroCall>()
  for (const statement of body) {
    if (statement.type === 'ExpressionStatement') {
      const expression = statement.expression
      if (
        expression.type === 'CallExpression' &&
        expression.callee.type === 'Identifier' &&
        locals.has(expression.callee.name)
      )
        calls.push(expression)
      continue
    }
    if (statement.type !== 'VariableDeclaration') continue
    for (const declarator of statement.declarations) {
      const expression = declarator.init
      if (
        expression?.type !== 'CallExpression' ||
        expression.callee.type !== 'Identifier' ||
        !locals.has(expression.callee.name)
      )
        continue
      if (statement.declarations.length !== 1 || declarator.id.type !== 'Identifier') {
        fail(file, declarator, 'definePage return value must use a single named variable')
      }
      calls.push(expression)
      queryCalls.set(expression, {
        start: statement.start ?? 0,
        end: statement.end ?? 0,
        queryVariable: declarator.id.name,
      })
    }
  }
  if (calls.length > 1) fail(file, calls[1], 'Only one definePage call is allowed per script block')
  const call = calls[0]
  let definition: ReturnType<typeof pageDefinition> | undefined
  if (call) {
    if (
      call.arguments.length !== 1 ||
      call.arguments[0].type === 'SpreadElement' ||
      call.arguments[0].type === 'ArgumentPlaceholder'
    ) {
      fail(file, call, 'definePage expects exactly one object argument')
    }
    definition = pageDefinition(call.arguments[0], file, script)
  }
  return {
    calls: calls.map(
      item =>
        queryCalls.get(item) ?? {
          start: item.start ?? 0,
          end: item.end ?? 0,
        },
    ),
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
  let scriptSetupOffset: number | undefined
  const analyses = blocks.map(block => {
    const declaredOffset = block.loc.start.offset
    const contentOffset =
      declaredOffset != null && source.startsWith(block.content, declaredOffset)
        ? declaredOffset
        : source.indexOf(block.content, declaredOffset ?? 0)
    if (contentOffset < 0) {
      throw new Error(`[uni-router] ${file}: Cannot locate the content of a script block`)
    }
    if (block.setup) scriptSetupOffset = contentOffset
    const analysis = analyzeScript(block.content, file)
    const hasQueryVariable = analysis.calls.some(call => call.queryVariable)
    if (hasQueryVariable) {
      if (!block.setup) fail(file, null, 'definePage return value requires <script setup>')
      if (definePropsRE.test(block.content)) {
        fail(file, null, 'definePage return value cannot be combined with defineProps')
      }
    }
    return {
      ...analysis,
      calls: analysis.calls.map(call => ({
        start: contentOffset + call.start,
        end: contentOffset + call.end,
        ...(call.queryVariable ? { queryVariable: call.queryVariable } : {}),
      })),
      imports: analysis.imports.map(declaration => ({
        ...declaration,
        start: contentOffset + declaration.start,
        end: contentOffset + declaration.end,
        specifiers: declaration.specifiers.map(specifier => ({
          start: contentOffset + specifier.start,
          end: contentOffset + specifier.end,
        })),
      })),
    }
  })
  const calls = analyses.flatMap(item => item.calls)
  if (calls.length > 1)
    throw new Error(`[uni-router] ${file}: Only one definePage call is allowed per page`)
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
    ...(scriptSetupOffset != null ? { scriptSetupOffset } : {}),
  }
}
