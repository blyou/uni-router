import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { glob } from 'tinyglobby'
import { analyzePage } from './analyzer'
import type { PageMacroAnalysis } from './analyzer'
import type { ResolvedRouteDir, ResolvedUniRouterOptions } from './options'
import { loadSfcParser } from './sfc'
import type { SfcParser } from './sfc'
import type { PageMeta, RouteFileInfo } from './types'
import { mapLimit, normalizePath } from './utils'

export { analyzePage } from './analyzer'
export { resolveOptions } from './options'
export type { PageMacroAnalysis } from './analyzer'
export type { ResolvedRouteDir, ResolvedUniRouterOptions } from './options'

export interface RouteManifest {
  routes: RouteFileInfo[]
  managedMainRoots: string[]
  managedSubPackageRoots: string[]
  excludedPaths: string[]
}

interface CachedFile {
  source: string
  analysis: PageMacroAnalysis
}

/** Reuses SFC analyses while the file content is unchanged. */
export interface ScanCache {
  files: Map<string, CachedFile>
}

interface ScanJob {
  dir: ResolvedRouteDir
  relativeFile: string
  absoluteFile: string
  fullPath: string
}

const scanConcurrency = 32

export function createScanCache(): ScanCache {
  return { files: new Map() }
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
  const rank = (path: string) => (path === 'pages/index/index' ? 0 : path === 'pages/index' ? 1 : 2)
  return rank(a.path) - rank(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

function collectJobs(
  options: ResolvedUniRouterOptions,
  dir: ResolvedRouteDir,
  relativeFiles: string[],
  included: Set<string>,
  seen: Map<string, string>,
  excludedPaths: string[],
): ScanJob[] {
  const jobs: ScanJob[] = []
  for (const relativeFile of relativeFiles) {
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
    if (previous)
      throw new Error(
        `[uni-router] Duplicate page "${fullPath}" in ${previous} and ${absoluteFile}`,
      )
    seen.set(fullPath, absoluteFile)
    jobs.push({ dir, relativeFile, absoluteFile, fullPath })
  }
  return jobs
}

async function analyzeCached(absoluteFile: string, parseSfc: SfcParser, cache: ScanCache) {
  const source = await readFile(absoluteFile, 'utf8')
  const cached = cache.files.get(absoluteFile)
  if (cached?.source === source) return cached.analysis
  const analysis = analyzePage(source, absoluteFile, parseSfc)
  cache.files.set(absoluteFile, { source, analysis })
  return analysis
}

export async function scanPages(
  options: ResolvedUniRouterOptions,
  cache: ScanCache = createScanCache(),
): Promise<RouteManifest> {
  const parseSfc = await loadSfcParser(options.root, options.compilerSfc)
  const excludedPaths: string[] = []
  const seen = new Map<string, string>()
  const jobs: ScanJob[] = []
  const scannedFiles = new Set<string>()

  for (const dir of options.dirs) {
    const [allFiles, includedFiles] = await Promise.all([
      glob(dir.include, { cwd: dir.src, onlyFiles: true, dot: false }),
      dir.exclude.length
        ? glob(dir.include, { cwd: dir.src, onlyFiles: true, dot: false, ignore: dir.exclude })
        : undefined,
    ])
    const relativeFiles = allFiles.map(normalizePath).sort()
    // Without exclude rules every scanned file is included, so reuse the normalized list.
    const included = new Set(includedFiles ? includedFiles.map(normalizePath) : relativeFiles)
    jobs.push(...collectJobs(options, dir, relativeFiles, included, seen, excludedPaths))
  }

  const analyses = await mapLimit(jobs, scanConcurrency, async job => {
    scannedFiles.add(job.absoluteFile)
    return { job, analysis: await analyzeCached(job.absoluteFile, parseSfc, cache) }
  })

  const routes = analyses.map(({ job, analysis }) => {
    const meta = mergeMeta(options.defaultMeta, analysis.meta ?? {})
    const subPackage = job.dir.subPackage ? job.dir.base : undefined
    const pagePath = subPackage ? withoutExtension(job.relativeFile) : job.fullPath
    const file = normalizePath(relative(options.root, job.absoluteFile))
    if (subPackage && analysis.tabBar) {
      throw new Error(`[uni-router] ${file}: tabBar pages must be in the main package`)
    }
    return {
      file,
      path: job.fullPath,
      page: { ...meta, path: pagePath },
      meta,
      query: analysis.query ?? {},
      queryTypes: analysis.queryTypes,
      tabBar: analysis.tabBar,
      ifdef: analysis.ifdef,
      ifndef: analysis.ifndef,
      homepage: analysis.homepage,
      ...(subPackage ? { subPackage } : {}),
    } satisfies RouteFileInfo
  })

  for (const file of cache.files.keys()) {
    if (!scannedFiles.has(file)) cache.files.delete(file)
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
    managedMainRoots: [
      ...new Set(options.dirs.filter(dir => !dir.subPackage).map(dir => dir.base)),
    ],
    managedSubPackageRoots: [
      ...new Set(options.dirs.filter(dir => dir.subPackage).map(dir => dir.base)),
    ],
    excludedPaths: [...new Set(excludedPaths)],
  }
}
