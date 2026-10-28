import { isAbsolute, relative, resolve } from 'node:path'
import type { PageMeta, RouteDirOptions, UniRouterOptions } from './types'
import { normalizePath } from './utils'

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

export function resolveOptions(
  options: UniRouterOptions = {},
  root = process.cwd(),
): ResolvedUniRouterOptions {
  const resolvedRoot = resolve(root)
  const srcDir = resolve(resolvedRoot, options.srcDir ?? 'src')
  const dirs = options.dirs ?? [options.srcDir ? `${options.srcDir}/pages` : 'src/pages']
  const resolvedDirs = dirs.map(dir => {
    const value = typeof dir === 'string' ? { src: dir } : dir
    const absoluteSrc = resolve(resolvedRoot, value.src)
    const base = normalizePath(relative(srcDir, absoluteSrc))
    if (base === '..' || base.startsWith('../') || isAbsolute(base)) {
      throw new Error(`[uni-router] Scan directory must be inside srcDir: ${value.src}`)
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

  const pagesJson = resolve(resolvedRoot, options.pagesJson ?? resolve(srcDir, 'pages.json'))
  const dts =
    options.dts === false ? false : resolve(resolvedRoot, options.dts ?? 'uni-router.d.ts')
  if (dts && dts === pagesJson) {
    throw new Error('[uni-router] pagesJson and dts must point to different files')
  }

  return {
    root: resolvedRoot,
    compilerSfc: options.compilerSfc ?? '@vue/compiler-sfc',
    srcDir,
    dirs: resolvedDirs,
    pagesJson,
    dts,
    defaultMeta: options.defaultMeta ?? {},
    sort: options.sort,
    merge: options.merge ?? true,
    watch: options.watch ?? true,
  }
}
