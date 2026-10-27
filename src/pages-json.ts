import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { PagesConfig, SubPackage, UserTabBarItem } from '@uni-helper/uni-pages-types'
import { applyEdits, findNodeAtLocation, modify, parse, parseTree, printParseErrorCode } from 'jsonc-parser'
import type { ParseError } from 'jsonc-parser'
import { normalizePath } from './scanner'
import type { ResolvedUniRouterOptions, RouteManifest } from './scanner'

export interface PagesJsonResult {
  config: PagesConfig
  content: string
  changed: boolean
}

function pagePath(path: string) {
  return normalizePath(path).replace(/^\/+/, '')
}

function inRoot(path: string, root: string) {
  return !root || path === root || path.startsWith(`${root}/`)
}

function subPagePath(root: string, path: string) {
  return `${root}/${path}`
}

function orderFields<T>(value: T, firstKey: string): T {
  const entries = Object.entries(value as Record<string, unknown>)
  const first = entries.find(([key]) => key === firstKey)
  const rest = entries
    .filter(([key]) => key !== firstKey)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return Object.fromEntries(first ? [first, ...rest] : rest) as T
}

interface PageConditions {
  ifdef?: readonly string[]
  ifndef?: readonly string[]
}

function routeConditions(manifest: RouteManifest): Map<string, PageConditions> {
  const conditions = new Map<string, PageConditions>()
  for (const route of manifest.routes) {
    if (!route.ifdef?.length && !route.ifndef?.length) continue
    conditions.set(pagePath(route.path), {
      ...(route.ifdef?.length ? { ifdef: route.ifdef } : {}),
      ...(route.ifndef?.length ? { ifndef: route.ifndef } : {}),
    })
  }
  return conditions
}

function allPagePaths(config: PagesConfig) {
  const paths = (config.pages ?? []).map(page => pagePath(page.path))
  for (const subPackage of config.subPackages ?? []) {
    for (const page of subPackage.pages) paths.push(pagePath(subPagePath(subPackage.root, page.path)))
  }
  return new Set(paths)
}

function generatedSubPackages(manifest: RouteManifest, existing: SubPackage[], merge: boolean) {
  const roots = [...new Set([
    ...(merge ? manifest.managedSubPackageRoots : []),
    ...manifest.routes.flatMap(route => route.subPackage ? [route.subPackage] : []),
  ])].sort()
  const excluded = new Set(manifest.excludedPaths)
  const managed: SubPackage[] = []

  for (const root of roots) {
    const previous = existing.find(item => pagePath(item.root) === root)
    const generated = manifest.routes
      .filter(route => route.subPackage === root)
      .map(route => orderFields(route.page, 'path'))
    const manual = merge
      ? (previous?.pages ?? [])
          .filter(page => excluded.has(pagePath(subPagePath(root, page.path))))
          .map(page => orderFields(page, 'path'))
      : []
    if (!generated.length && !manual.length) continue
    managed.push({ ...previous, root, pages: [...generated, ...manual] })
  }

  if (!merge) return managed
  const unmanaged = existing.filter(item => !manifest.managedSubPackageRoots.includes(pagePath(item.root)))
  return [...managed, ...unmanaged]
}

function mergeTabBar(
  current: PagesConfig,
  manifest: RouteManifest,
  pages: NonNullable<PagesConfig['pages']>,
  merge: boolean,
): PagesConfig['tabBar'] | undefined {
  const routes = manifest.routes.filter(
    (route): route is RouteManifest['routes'][number] & { tabBar: UserTabBarItem } =>
      Boolean(route.tabBar),
  )
  if (!routes.length) return merge ? current.tabBar : undefined

  const generated = routes
    .map((route, order) => ({ route, order }))
    .sort((a, b) =>
      (a.route.tabBar.index ?? Number.MAX_SAFE_INTEGER) - (b.route.tabBar.index ?? Number.MAX_SAFE_INTEGER)
      || a.order - b.order,
    )
    .map(({ route }) => {
      const item = orderFields({ ...route.tabBar, pagePath: pagePath(route.path) }, 'pagePath')
      delete item.index
      return item
    })
  const generatedPaths = new Set(generated.map(item => item.pagePath))
  const pagePaths = new Set(pages.map(page => pagePath(page.path)))
  const manual = merge
    ? (current.tabBar?.list ?? [])
        .filter(item => {
          const path = pagePath(item.pagePath)
          return pagePaths.has(path) && !generatedPaths.has(path)
        })
        .map(item => orderFields(item, 'pagePath'))
    : []
  return { ...current.tabBar, list: [...generated, ...manual] }
}

function validateRemovedTabs(before: PagesConfig, after: PagesConfig) {
  const previousPaths = allPagePaths(before)
  const nextPaths = allPagePaths(after)
  for (const item of before.tabBar?.list ?? []) {
    const path = pagePath(item.pagePath)
    if (previousPaths.has(path) && !nextPaths.has(path)) {
      throw new Error(`[uni-router] tabBar references removed page "${item.pagePath}"; update tabBar or exclude the page from scanning`)
    }
  }
}

export function mergePagesConfig(
  current: PagesConfig,
  manifest: RouteManifest,
  options: Pick<ResolvedUniRouterOptions, 'merge' | 'sort'>,
): PagesConfig {
  const existingPages = current.pages ?? []
  const generated = manifest.routes.filter(route => !route.subPackage).map(route => route.page)
  const excluded = new Set(manifest.excludedPaths)
  const manual = options.merge
    ? existingPages.filter(page => {
        const path = pagePath(page.path)
        const managed = manifest.managedMainRoots.some(root => inRoot(path, root))
        return !managed || excluded.has(path)
      })
    : []
  const pages = [...generated, ...manual].map(page => orderFields(page, 'path'))
  const homepagePath = manifest.routes.find(route => route.homepage === true)?.path

  if (!homepagePath && options.merge && !options.sort && existingPages[0]) {
    const startupPath = pagePath(existingPages[0].path)
    const index = pages.findIndex(page => pagePath(page.path) === startupPath)
    if (index > 0) pages.unshift(...pages.splice(index, 1))
  }

  if (homepagePath) {
    const path = pagePath(homepagePath)
    const index = pages.findIndex(page => pagePath(page.path) === path)
    if (index > 0) pages.unshift(...pages.splice(index, 1))
  }

  const next: PagesConfig = { ...current, pages }
  const subPackages = generatedSubPackages(manifest, current.subPackages ?? [], options.merge)
  if (subPackages.length || current.subPackages) next.subPackages = subPackages
  else delete next.subPackages
  const tabBar = mergeTabBar(current, manifest, pages, options.merge)
  if (tabBar) next.tabBar = tabBar
  else delete next.tabBar
  if (options.merge && !manifest.routes.some(route => route.tabBar)) {
    validateRemovedTabs(current, next)
  }
  return next
}

function formatting(text: string) {
  const indent = text.match(/^[ \t]+(?=")/m)?.[0] ?? '  '
  return {
    insertSpaces: !indent.includes('\t'),
    tabSize: indent.includes('\t') ? 2 : indent.length,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  }
}

function addConditionalComments(
  content: string,
  config: PagesConfig,
  conditions: Map<string, PageConditions>,
  includeTabBar: boolean,
) {
  if (!conditions.size) return content
  const root = parseTree(content)
  if (!root) return content
  const targets: Array<{ path: string; nodePath: Array<string | number> }> = []
  const pages = config.pages ?? []
  pages.forEach((page, index) => {
    targets.push({ path: pagePath(page.path), nodePath: ['pages', index] })
  })
  for (const [subPackageIndex, subPackage] of (config.subPackages ?? []).entries()) {
    subPackage.pages.forEach((page, pageIndex) => {
      targets.push({
        path: pagePath(subPagePath(subPackage.root, page.path)),
        nodePath: ['subPackages', subPackageIndex, 'pages', pageIndex],
      })
    })
  }
  if (includeTabBar) {
    const tabBarList = config.tabBar?.list ?? []
    tabBarList.forEach((item, index) => {
      targets.push({ path: pagePath(item.pagePath), nodePath: ['tabBar', 'list', index] })
    })
  }

  const edits: Array<{ offset: number; content: string }> = []
  for (const target of targets) {
    const condition = conditions.get(target.path)
    if (!condition) continue
    const node = findNodeAtLocation(root, target.nodePath)
    if (!node) continue
    const directives: string[] = []
    if (condition.ifdef?.length) directives.push(`#ifdef ${condition.ifdef.join(' || ')}`)
    if (condition.ifndef?.length) directives.push(`#ifndef ${condition.ifndef.join(' || ')}`)
    if (!directives.length) continue

    const lineStart = content.lastIndexOf('\n', node.offset - 1) + 1
    const indent = content.slice(lineStart, node.offset).match(/^[\t ]*/)?.[0] ?? ''
    edits.push({
      offset: node.offset,
      content: directives.map(directive => `// ${directive}\n${indent}`).join(''),
    })
    let closeAt = node.offset + node.length
    while (closeAt < content.length && /[\t ]/.test(content[closeAt])) closeAt++
    if (content[closeAt] === ',') closeAt++
    edits.push({
      offset: closeAt,
      content: `\n${indent}// #endif`.repeat(directives.length),
    })
  }

  return edits
    .sort((a, b) => b.offset - a.offset)
    .reduce((result, edit) => result.slice(0, edit.offset) + edit.content + result.slice(edit.offset), content)
}

function serializeConfig(
  text: string,
  config: PagesConfig,
  existed: boolean,
  updateTabBar: boolean,
  conditions: Map<string, PageConditions>,
) {
  if (!existed) {
    return addConditionalComments(`${JSON.stringify(config, null, 2)}\n`, config, conditions, updateTabBar)
  }
  const options = formatting(text)
  let result = applyEdits(text, modify(text, ['pages'], config.pages, { formattingOptions: options }))
  if (config.subPackages) {
    result = applyEdits(result, modify(result, ['subPackages'], config.subPackages, { formattingOptions: options }))
  }
  if (updateTabBar) {
    result = applyEdits(result, modify(result, ['tabBar'], config.tabBar, { formattingOptions: options }))
  }
  result = addConditionalComments(result, config, conditions, updateTabBar)
  return result.endsWith('\n') ? result : `${result}\n`
}

async function writeAtomic(file: string, content: string) {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  try {
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, file)
  }
  catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

export async function updatePagesJson(
  options: ResolvedUniRouterOptions,
  manifest: RouteManifest,
): Promise<PagesJsonResult> {
  let text = ''
  let existed = true
  try {
    text = await readFile(options.pagesJson, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    existed = false
  }

  const errors: ParseError[] = []
  const current = text.trim()
    ? parse(text, errors, { allowTrailingComma: true }) as PagesConfig
    : {}
  if (errors.length) {
    const detail = errors.map(error => printParseErrorCode(error.error)).join(', ')
    throw new Error(`[uni-router] Invalid ${options.pagesJson}: ${detail}`)
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error(`[uni-router] ${options.pagesJson} must contain a JSON object`)
  }

  const config = mergePagesConfig(current, manifest, options)
  const content = serializeConfig(
    text,
    config,
    existed,
    !options.merge || manifest.routes.some(route => route.tabBar),
    routeConditions(manifest),
  )
  const changed = !existed || content !== text
  if (changed) await writeAtomic(options.pagesJson, content)
  return { config, content, changed }
}
