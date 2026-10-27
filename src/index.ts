import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { HmrContext, Plugin, ViteDevServer } from 'vite'
import { generateDeclarations, generateVirtualModule, writeDeclarations } from './generator'
import type { ResolvedUniRouterOptions } from './options'
import { updatePagesJson } from './pages-json'
import { createScanCache, resolveOptions, scanPages } from './scanner'
import type { RouteManifest } from './scanner'
import { loadSfcParser } from './sfc'
import { transformPage } from './transform'
import type { UniRouterOptions } from './types'
import { inside } from './utils'

const virtualId = '@blyou/uni-router/auto-routes'
const resolvedVirtualId = `\0${virtualId}`

export default function UniRouter(userOptions: UniRouterOptions = {}): Plugin {
  let options: ResolvedUniRouterOptions
  let virtualCode = ''
  let server: ViteDevServer | undefined
  let queue = Promise.resolve()
  let startupScan = false
  let lastManifest: RouteManifest | undefined
  let lastPagesContent: string | undefined
  let parserPromise: ReturnType<typeof loadSfcParser> | undefined
  const cache = createScanCache()

  const regenerate = () => {
    const run = queue.then(async () => {
      const nextManifest = await scanPages(options, cache)
      const pages = await updatePagesJson(options, nextManifest)
      const declarations = generateDeclarations(nextManifest.routes, pages.config)
      const dtsChanged = options.dts ? await writeDeclarations(options.dts, declarations) : false
      const nextVirtualCode = generateVirtualModule(nextManifest.routes, pages.config)
      const changed = pages.changed || dtsChanged || nextVirtualCode !== virtualCode
      virtualCode = nextVirtualCode
      lastManifest = nextManifest
      lastPagesContent = pages.content
      return changed
    })
    queue = run.then(
      () => {},
      () => {},
    )
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
    if (changed) invalidate()
    if (changed || (file && resolve(file) === options.pagesJson)) {
      server?.ws.send({ type: 'full-reload', path: '*' })
      return true
    }
    return false
  }

  const pagesJsonChanged = async (file: string) => {
    try {
      return (await readFile(file, 'utf8')) !== lastPagesContent
    } catch {
      return true
    }
  }

  const reportWatchError = (error: unknown) => {
    server?.config.logger.error(error instanceof Error ? error.message : String(error))
  }

  const addWatchFiles = (context: { addWatchFile: (id: string) => void }) => {
    context.addWatchFile(options.pagesJson)
    for (const dir of options.dirs) context.addWatchFile(dir.src)
    for (const route of lastManifest?.routes ?? []) {
      context.addWatchFile(resolve(options.root, route.file))
    }
  }

  return {
    name: '@blyou/uni-router',
    enforce: 'pre',
    async config(config) {
      options = resolveOptions(userOptions, config.root ?? process.cwd())
      config.optimizeDeps ??= {}
      config.optimizeDeps.exclude ??= []
      for (const id of [virtualId, '@blyou/uni-router']) {
        if (!config.optimizeDeps.exclude.includes(id)) config.optimizeDeps.exclude.push(id)
      }
      await regenerate()
      startupScan = true
    },
    async buildStart() {
      if (startupScan) startupScan = false
      else await regenerate()
      addWatchFiles(this)
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
        const run =
          resolve(file) === options.pagesJson
            ? pagesJsonChanged(resolve(file)).then(changed => (changed ? reload(file) : false))
            : reload(file)
        void run.catch(reportWatchError)
      }
      const onPagesJsonChange = (file: string) => {
        if (resolve(file) !== options.pagesJson) return
        void pagesJsonChanged(resolve(file))
          .then(changed => (changed ? reload(file) : false))
          .catch(reportWatchError)
      }
      server.watcher.on('add', onStructureChange)
      server.watcher.on('unlink', onStructureChange)
      server.watcher.on('change', onPagesJsonChange)
    },
    async handleHotUpdate(context: HmrContext) {
      if (!options.watch || !relevant(context.file)) return
      if (
        resolve(context.file) === options.pagesJson &&
        !(await pagesJsonChanged(options.pagesJson))
      )
        return
      if (await reload(context.file)) return []
    },
    async watchChange(id) {
      if (server || !options.watch || !relevant(id)) return
      if (resolve(id) === options.pagesJson && !(await pagesJsonChanged(options.pagesJson))) return
      await regenerate()
    },
    async transform(code, id) {
      if (id.includes('?')) return
      const file = id
      if (!/\.(?:vue|nvue|uvue)$/.test(file) || !code.includes('definePage')) return
      parserPromise ??= loadSfcParser(options.root, options.compilerSfc)
      return transformPage(code, file, await parserPromise)
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
