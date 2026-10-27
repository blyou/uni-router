import { isAbsolute, relative, resolve } from 'node:path'
import MagicString from 'magic-string'
import type { HmrContext, Plugin, ViteDevServer } from 'vite'
import { generateDeclarations, generateVirtualModule, writeDeclarations } from './generator'
import { updatePagesJson } from './pages-json'
import { analyzePage, resolveOptions, scanPages } from './scanner'
import type { ResolvedUniRouterOptions } from './scanner'
import type { NormalizedQuerySchema, UniRouterOptions } from './types'

const virtualId = '@blyou/uni-router/auto-routes'
const resolvedVirtualId = `\0${virtualId}`

function inside(file: string, directory: string) {
  const path = relative(directory, file)
  return !path || (!path.startsWith('..') && !isAbsolute(path))
}

function removeImportSpecifiers(code: string, magic: MagicString, analysis: ReturnType<typeof analyzePage>) {
  if (analysis.calls.some(call => call.propsVariable)) {
    for (const declaration of analysis.imports) {
      for (const specifier of declaration.specifiers) {
        magic.overwrite(specifier.start, specifier.end, 'usePageQuery')
      }
    }
    return
  }
  for (const declaration of analysis.imports) {
    if (declaration.removeAll) {
      magic.remove(declaration.start, declaration.end)
      continue
    }
    for (const specifier of [...declaration.specifiers].sort((a, b) => b.start - a.start)) {
      let start = specifier.start
      let end = specifier.end
      while (end < code.length && /[ \t]/.test(code[end])) end++
      if (code[end] === ',') {
        end++
        while (end < code.length && /[ \t]/.test(code[end])) end++
      }
      else {
        while (start > declaration.start && /[ \t]/.test(code[start - 1])) start--
        if (code[start - 1] === ',') start--
      }
      magic.remove(start, end)
    }
  }
}

function pageProps(variable: string, schema: NormalizedQuerySchema, formats: Record<string, string> = {}) {
  const props = Object.entries(schema).map(([name, field]) =>
    `${JSON.stringify(name)}: { type: String, required: ${field.required} }`,
  )
  const query = Object.entries(schema).map(([name, field]) => {
    const format = formats[name] ? `, format: ${formats[name]}` : ''
    return `${JSON.stringify(name)}: { type: ${JSON.stringify(field.type)}, required: ${field.required}${format} }`
  })
  return `const __uniRouterPageProps = defineProps({ ${props.join(', ')} })\nconst ${variable} = usePageQuery(__uniRouterPageProps, { ${query.join(', ')} })`
}

export default function UniRouter(userOptions: UniRouterOptions = {}): Plugin {
  let options: ResolvedUniRouterOptions
  let virtualCode = ''
  let server: ViteDevServer | undefined
  let queue = Promise.resolve()

  const regenerate = () => {
    const run = queue.then(async () => {
      const nextManifest = await scanPages(options)
      const pages = await updatePagesJson(options, nextManifest)
      const declarations = generateDeclarations(nextManifest.routes, pages.config)
      const dtsChanged = options.dts ? await writeDeclarations(options.dts, declarations) : false
      const nextVirtualCode = generateVirtualModule(nextManifest.routes, pages.config)
      const changed = pages.changed || dtsChanged || nextVirtualCode !== virtualCode
      virtualCode = nextVirtualCode
      return changed
    })
    queue = run.then(() => {}, () => {})
    return run
  }

  const invalidate = () => {
    const module = server?.moduleGraph.getModuleById(resolvedVirtualId)
    if (module) server?.moduleGraph.invalidateModule(module)
  }

  const relevant = (file: string) => {
    const absoluteFile = resolve(file)
    if (absoluteFile === options.pagesJson) return true
    if (options.dts && absoluteFile === options.dts) return false
    return options.dirs.some(dir => inside(absoluteFile, dir.src))
  }

  const reload = async (file?: string) => {
    const changed = await regenerate()
    invalidate()
    if (changed || (file && resolve(file) === options.pagesJson)) {
      server?.ws.send({ type: 'full-reload', path: '*' })
      return true
    }
    return false
  }

  const reportWatchError = (error: unknown) => {
    server?.config.logger.error(error instanceof Error ? error.message : String(error))
  }

  return {
    name: '@blyou/uni-router',
    enforce: 'pre',
    async config(config) {
      options = resolveOptions(userOptions, config.root ?? process.cwd())
      config.optimizeDeps ??= {}
      config.optimizeDeps.exclude ??= []
      if (!config.optimizeDeps.exclude.includes('@blyou/uni-router')) {
        config.optimizeDeps.exclude.push('@blyou/uni-router')
      }
      await regenerate()
    },
    async buildStart() {
      await regenerate()
    },
    resolveId(id) {
      if (id === virtualId) return resolvedVirtualId
    },
    load(id) {
      if (id === resolvedVirtualId) return virtualCode
    },
    configureServer(viteServer) {
      server = viteServer
      if (!options.watch) return
      server.watcher.add([...options.dirs.map(dir => dir.src), options.pagesJson])
      const onStructureChange = (file: string) => {
        if (!relevant(file)) return
        void reload(file).catch(reportWatchError)
      }
      server.watcher.on('add', onStructureChange)
      server.watcher.on('unlink', onStructureChange)
    },
    async handleHotUpdate(context: HmrContext) {
      if (!options.watch || !relevant(context.file)) return
      if (await reload(context.file)) return []
    },
    async watchChange(id) {
      if (!server && options.watch && relevant(id)) await regenerate()
    },
    transform(code, id) {
      const file = id.split('?')[0]
      if (!file.endsWith('.vue') || !code.includes('definePage')) return
      const analysis = analyzePage(code, file)
      if (!analysis.calls.length) return
      const magic = new MagicString(code)
      for (const call of analysis.calls) {
        if (call.propsVariable) {
          if (!analysis.imports.length) {
            magic.appendLeft(call.start, `import { usePageQuery } from '@blyou/uni-router'\n`)
          }
          magic.overwrite(call.start, call.end, pageProps(call.propsVariable, analysis.query ?? {}, analysis.formats))
        }
        else magic.remove(call.start, call.end)
      }
      removeImportSpecifiers(code, magic, analysis)
      return {
        code: magic.toString(),
        map: magic.generateMap({ source: file, includeContent: true, hires: true }),
      }
    },
  }
}

export type {
  ConditionalPlatform,
  ConditionalPlatformToken,
  PageDefinition,
  PageMeta,
  PageQuery,
  QueryConstructor,
  QueryField,
  QueryFormatter,
  QuerySchema,
  QueryType,
  RouteDirOptions,
  RouteFileInfo,
  UniRouterOptions,
} from './types'
export type { PagesConfig, PageMetaDatum, SubPackage, UserPageMeta } from './types'
