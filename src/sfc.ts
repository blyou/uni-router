import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface SfcBlock {
  content: string
  loc: { start: { offset?: number } }
  setup?: boolean
}

export interface SfcDescriptor {
  script?: SfcBlock | null
  scriptSetup?: SfcBlock | null
}

export interface SfcParseError {
  message: string
}

export interface SfcParseResult {
  descriptor: SfcDescriptor
  errors: SfcParseError[]
}

export type SfcParser = (source: string, options: { filename: string }) => SfcParseResult

const parserCache = new Map<string, Promise<SfcParser>>()
const resolvedCompilerCache = new Map<string, string>()

function resolveCompiler(root: string, compiler: string) {
  const roots = compiler === '@vue/compiler-sfc' ? [root, process.cwd()] : [root]
  for (const directory of new Set(roots.map(item => resolve(item)))) {
    try {
      const require = createRequire(resolve(directory, 'package.json'))
      return require.resolve(compiler)
    } catch {
      continue
    }
  }
  throw new Error(
    `[uni-router] Cannot resolve "${compiler}" from ${root}. ` +
      'Install a compatible @vue/compiler-sfc or configure the compilerSfc option.',
  )
}

function compilerParser(module: unknown): SfcParser {
  const compiler = module as { parse?: SfcParser; default?: { parse?: SfcParser } }
  const parse = compiler.parse ?? compiler.default?.parse
  if (typeof parse !== 'function') {
    throw new Error('[uni-router] The resolved @vue/compiler-sfc does not export parse()')
  }
  return parse
}

export async function loadSfcParser(
  root: string,
  compiler = '@vue/compiler-sfc',
): Promise<SfcParser> {
  // Resolving the compiler walks node_modules; memoize it so repeated scans stay cheap.
  const resolveKey = `${root}\0${compiler}`
  let resolved = resolvedCompilerCache.get(resolveKey)
  if (resolved === undefined) {
    resolved = resolveCompiler(root, compiler)
    resolvedCompilerCache.set(resolveKey, resolved)
  }
  let parser = parserCache.get(resolved)
  if (!parser) {
    parser = import(pathToFileURL(resolved).href).then(compilerParser)
    parserCache.set(resolved, parser)
  }
  return parser
}

let fallbackParser: SfcParser | undefined

export function fallbackSfcParser(): SfcParser {
  if (!fallbackParser) {
    const require = createRequire(resolve(process.cwd(), 'package.json'))
    fallbackParser = compilerParser(require('@vue/compiler-sfc'))
  }
  return fallbackParser
}
