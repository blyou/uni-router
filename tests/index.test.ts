import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PagesConfig } from '@uni-helper/uni-pages-types'
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
import { generateDeclarations, generateVirtualModule, runtimeRoutes } from '../src/generator'
import { mergePagesConfig, updatePagesJson } from '../src/pages-json'
import {
  definePage,
  navigateTo,
  parseQuery,
  redirectTo,
  reLaunch,
  switchTab,
  usePageQuery,
} from '../src/runtime'
import type {
  NonTabRoutePath,
  QueryType,
  RoutePath,
  RouteQuery,
  TabRoutePath,
} from '../src/runtime'
import { analyzePage, createScanCache, resolveOptions, scanPages } from '../src/scanner'
import { loadSfcParser } from '../src/sfc'
import type { RouteManifest } from '../src/scanner'
import type { NormalizedQuerySchema, RouteFileInfo } from '../src/types'

declare module '../src/runtime' {
  interface UniRouteMap {
    '/pages/index/index': {
      query: Record<string, never>
      meta: { title: 'Home' }
      tab: true
    }
    '/pages/login/index': {
      query: Record<string, never>
      meta: { title: 'Login' }
      tab: false
    }
    '/pages/user/detail': {
      query: { id: number; preview?: boolean; obj?: { a: number; b: string; c: boolean } }
      meta: { title: 'Detail' }
      tab: false
    }
    '/pages/object': {
      query: { obj: Record<string, unknown> }
      meta: object
      tab: false
    }
  }
}

const temporaryDirectories: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'uni-router-'))
  temporaryDirectories.push(root)
  return root
}

async function writePage(root: string, file: string, content = '<template><view /></template>') {
  const target = join(root, file)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
}

function route(
  path: string,
  query: NormalizedQuerySchema = {},
  subPackage?: string,
): RouteFileInfo {
  return {
    file: `src/${path}.vue`,
    path,
    page: { path: subPackage ? path.slice(subPackage.length + 1) : path },
    meta: {},
    query,
    ...(subPackage ? { subPackage } : {}),
  }
}

function manifest(routes: RouteFileInfo[]): RouteManifest {
  return {
    routes,
    managedMainRoots: ['pages'],
    managedSubPackageRoots: [
      ...new Set(routes.flatMap(item => (item.subPackage ? [item.subPackage] : []))),
    ],
    excludedPaths: [],
  }
}

function typeAssertions() {
  navigateTo('/pages/user/detail', { id: 1, preview: true })
  redirectTo('/pages/user/detail', { id: 1 })
  switchTab('/pages/index/index')
  navigateTo('/pages/login/index', undefined, { animationType: 'fade-in' })

  // @ts-expect-error required query is missing
  navigateTo('/pages/user/detail')
  // @ts-expect-error query values must use their declared types
  navigateTo('/pages/user/detail', { id: '1' })
  // @ts-expect-error unknown paths are rejected
  reLaunch('/pages/missing')
  // @ts-expect-error only tabBar pages can use switchTab
  switchTab('/pages/user/detail')
  // @ts-expect-error tabBar pages must use switchTab
  navigateTo('/pages/index/index')
  // @ts-expect-error tabBar pages must use switchTab
  redirectTo('/pages/index/index')
  // @ts-expect-error tabBar pages must use switchTab
  reLaunch('/pages/index/index')
  // @ts-expect-error routes without a schema reject arbitrary query values
  reLaunch('/pages/login/index', { arbitrary: 'value' })

  definePage({
    // @ts-expect-error unknown query field options are rejected
    query: { id: { type: Number, requireds: true } },
  })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('route types', () => {
  test('derives paths and query types from the augmented route map', () => {
    expectTypeOf<RoutePath>().toEqualTypeOf<
      '/pages/index/index' | '/pages/login/index' | '/pages/user/detail' | '/pages/object'
    >()
    expectTypeOf<TabRoutePath>().toEqualTypeOf<'/pages/index/index'>()
    expectTypeOf<NonTabRoutePath>().toEqualTypeOf<
      '/pages/login/index' | '/pages/user/detail' | '/pages/object'
    >()
    expectTypeOf<RouteQuery<'/pages/user/detail'>>().toEqualTypeOf<{
      id: number
      preview?: boolean
      obj?: { a: number; b: string; c: boolean }
    }>()
    const query = definePage({
      query: {
        id: Number,
        preview: { type: Boolean, required: false },
        obj: { type: Object as QueryType<{ a: number; b: string; c: boolean }> },
      },
    })
    expectTypeOf(query.id).toEqualTypeOf<number>()
    expectTypeOf(query.preview).toEqualTypeOf<boolean | undefined>()
    expectTypeOf(query.obj).toEqualTypeOf<{ a: number; b: string; c: boolean }>()
    expectTypeOf(typeAssertions).toBeFunction()
  })

  test('infers page query types from the generated normalized schema', () => {
    const query = usePageQuery(
      { id: '1', obj: '{}' },
      {
        id: { type: 'number', required: true },
        preview: { type: 'boolean', required: false },
        obj: { type: 'object', required: true },
      },
    )
    expectTypeOf(query.id).toEqualTypeOf<number>()
    expectTypeOf(query.preview).toEqualTypeOf<boolean | undefined>()
    expectTypeOf(query.obj).toEqualTypeOf<Record<string, unknown>>()
  })
})

describe('page scanning', () => {
  test('loads the sfc compiler from the host project', async () => {
    const parseSfc = await loadSfcParser(process.cwd())
    const result = parseSfc('<template><view /></template>', { filename: 'page.vue' })
    expect(result.errors).toEqual([])
    expect(result.descriptor).toBeTruthy()
  })

  test('reports a missing configured sfc compiler', async () => {
    await expect(loadSfcParser(process.cwd(), 'missing-compiler-sfc')).rejects.toThrow(
      'Cannot resolve "missing-compiler-sfc"',
    )
  })

  test('extracts static metadata, query schemas, and macro source ranges', () => {
    const source = `<template><view /></template>\n<script setup lang="ts">\nimport { definePage as page } from '@blyou/uni-router'\npage({\n  style: { navigationBarTitleText: 'Detail' },\n  query: { id: Number, preview: { type: Boolean, required: false } },\n} as const)\n</script>`
    const analysis = analyzePage(source, 'detail.vue')

    expect(analysis.meta).toEqual({ style: { navigationBarTitleText: 'Detail' } })
    expect(analysis.query).toEqual({
      id: { type: 'number', required: true },
      preview: { type: 'boolean', required: false },
    })
    expect(source.slice(analysis.calls[0].start, analysis.calls[0].end)).toMatch(/^page\(/)
    expect(analysis.imports).toHaveLength(1)
  })

  test('recognizes query variables assigned by definePage', () => {
    const source = `<script setup lang="ts">\nconst query = definePage({ query: { id: Number, preview: { type: Boolean, format: JSON.parse }, obj: { type: Object as QueryType<{ a: number }> } } })\n</script>`
    const analysis = analyzePage(source, 'props.vue')
    expect(analysis.calls[0].queryVariable).toBe('query')
    expect(source.slice(analysis.calls[0].start, analysis.calls[0].end)).toMatch(
      /^const query = definePage/,
    )
    expect(analysis.query).toEqual({
      id: { type: 'number', required: true },
      preview: { type: 'boolean', required: true },
      obj: { type: 'object', required: true },
    })
    expect(analysis.formats).toEqual({ preview: 'JSON.parse' })
    expect(analysis.queryTypes).toEqual({ obj: '{ a: number }' })
  })

  test('extracts page-level tabBar from definePage', () => {
    const source = `<script setup lang="ts">\ndefinePage({ tabBar: { text: 'Home', index: 0 }, style: { navigationBarTitleText: 'Home' } })\n</script>`
    const analysis = analyzePage(source, 'home.vue')
    expect(analysis.tabBar).toEqual({ text: 'Home', index: 0 })
    expect(analysis.meta).toEqual({ style: { navigationBarTitleText: 'Home' } })
  })

  test('extracts and normalizes conditional compilation platforms from definePage', () => {
    const source = `<script setup lang="ts">\ndefinePage({ ifdef: ['web'], ifndef: ['MP_WEIXIN'] })\n</script>`
    const analysis = analyzePage(source, 'mine.vue')
    expect(analysis.ifdef).toEqual(['WEB'])
    expect(analysis.ifndef).toEqual(['MP-WEIXIN'])
    expect(analysis.meta).toEqual({})
  })

  test('rejects empty or non-string conditional compilation platforms', () => {
    expect(() =>
      analyzePage(`<script setup lang="ts">\ndefinePage({ ifdef: [] })\n</script>`, 'mine.vue'),
    ).toThrow('ifdef must be a non-empty array of platform strings')
    expect(() =>
      analyzePage(
        `<script setup lang="ts">\ndefinePage({ ifndef: ['MP-WEIXIN', 1] })\n</script>`,
        'mine.vue',
      ),
    ).toThrow('ifndef must contain non-empty platform strings')
  })

  test('extracts the homepage flag from definePage', () => {
    const source = `<script setup lang="ts">\ndefinePage({ homepage: true, style: { navigationBarTitleText: 'Home' } })\n</script>`
    const analysis = analyzePage(source, 'home.vue')
    expect(analysis.homepage).toBe(true)
    expect(analysis.meta).toEqual({ style: { navigationBarTitleText: 'Home' } })
  })

  test('rejects non-static route metadata', () => {
    const source = `<script setup lang="ts">\nimport { definePage } from '@blyou/uni-router'\ndefinePage({ style: getStyle() })\n</script>`
    expect(() => analyzePage(source, 'dynamic.vue')).toThrow(
      'Route config must be a static literal',
    )
  })

  test('rejects unsupported or malformed definePage options', () => {
    expect(() =>
      analyzePage(
        `<script setup lang="ts">\ndefinePage({ type: 'page' })\n</script>`,
        'unknown.vue',
      ),
    ).toThrow('Unknown definePage option "type"')
    expect(() =>
      analyzePage(`<script setup lang="ts">\ndefinePage({ style: [] })\n</script>`, 'style.vue'),
    ).toThrow('style must be a static object')
    expect(() =>
      analyzePage(
        `<script setup lang="ts">\ndefinePage({ needLogin: 'yes' })\n</script>`,
        'login.vue',
      ),
    ).toThrow('needLogin must be a boolean literal')
    expect(() =>
      analyzePage(
        `<script setup lang="ts">\ndefinePage({ query: { id: { type: Number, type: String } } })\n</script>`,
        'query.vue',
      ),
    ).toThrow('Duplicate query field option "type"')
  })

  test('scans main and sub-package pages with merged default metadata', async () => {
    const root = await fixture()
    await writePage(root, 'src/pages/index/index.vue')
    await writePage(
      root,
      'src/pages/user/detail.vue',
      `<script setup lang="ts">\nimport { definePage } from '@blyou/uni-router'\ndefinePage({ style: { navigationBarTitleText: 'Detail' }, query: { id: Number } })\n</script>`,
    )
    await writePage(root, 'src/shop/cart.vue')
    const options = resolveOptions(
      {
        dirs: ['src/pages', { src: 'src/shop', subPackage: true }],
        defaultMeta: { style: { navigationBarTitleText: 'Default', enablePullDownRefresh: true } },
      },
      root,
    )

    const result = await scanPages(options)
    expect(result.routes.map(item => item.path)).toEqual([
      'pages/index/index',
      'pages/user/detail',
      'shop/cart',
    ])
    const detail = result.routes[1]
    expect(detail.file).toBe('src/pages/user/detail.vue')
    expect(detail.meta.style).toEqual({
      navigationBarTitleText: 'Detail',
      enablePullDownRefresh: true,
    })
    expect(detail.query).toEqual({ id: { type: 'number', required: true } })
    expect(result.routes[2].page.path).toBe('cart')
    expect(result.routes[2].subPackage).toBe('shop')
  })

  test('rejects tabBar on sub-package pages', async () => {
    const root = await fixture()
    await writePage(
      root,
      'src/shop/cart.vue',
      `<script setup lang="ts">\ndefinePage({ tabBar: { text: 'Cart' } })\n</script>`,
    )
    const options = resolveOptions({ dirs: [{ src: 'src/shop', subPackage: true }] }, root)
    await expect(scanPages(options)).rejects.toThrow('tabBar pages must be in the main package')
  })

  test('always places the homepage first and sorts the remaining pages', async () => {
    const root = await fixture()
    await writePage(root, 'src/pages/about.vue')
    await writePage(
      root,
      'src/pages/home/index.vue',
      `<script setup lang="ts">\ndefinePage({ homepage: true })\n</script>`,
    )
    await writePage(root, 'src/pages/zeta.vue')
    const options = resolveOptions(
      {
        sort: (a, b) => b.path.localeCompare(a.path),
      },
      root,
    )

    const result = await scanPages(options)
    expect(result.routes.map(item => item.path)).toEqual([
      'pages/home/index',
      'pages/zeta',
      'pages/about',
    ])
    expect(result.routes[0].homepage).toBe(true)
    expect(result.routes[0].page).toEqual({ path: 'pages/home/index' })
    expect(options.compilerSfc).toBe('@vue/compiler-sfc')
  })

  test('accepts a custom sfc compiler path', () => {
    const options = resolveOptions({ compilerSfc: './compiler.cjs' }, process.cwd())
    expect(options.compilerSfc).toBe('./compiler.cjs')
  })

  test('rejects a declaration file that would overwrite pages.json', () => {
    expect(() => resolveOptions({ pagesJson: 'src/pages.json', dts: 'src/pages.json' })).toThrow(
      'pagesJson and dts must point to different files',
    )
  })

  test('rejects multiple homepage pages', async () => {
    const root = await fixture()
    await writePage(
      root,
      'src/pages/home/index.vue',
      `<script setup lang="ts">\ndefinePage({ homepage: true })\n</script>`,
    )
    await writePage(
      root,
      'src/pages/start/index.vue',
      `<script setup lang="ts">\ndefinePage({ homepage: true })\n</script>`,
    )
    const options = resolveOptions({}, root)
    await expect(scanPages(options)).rejects.toThrow('Multiple homepage pages are not allowed')
  })

  test('rejects homepage on sub-package pages', async () => {
    const root = await fixture()
    await writePage(
      root,
      'src/shop/index.vue',
      `<script setup lang="ts">\ndefinePage({ homepage: true })\n</script>`,
    )
    const options = resolveOptions({ dirs: [{ src: 'src/shop', subPackage: true }] }, root)
    await expect(scanPages(options)).rejects.toThrow('homepage pages must be in the main package')
  })

  test('reuses cached analyses while reflecting file changes', async () => {
    const root = await fixture()
    await writePage(
      root,
      'src/pages/index/index.vue',
      `<script setup lang="ts">\ndefinePage({ style: { navigationBarTitleText: 'First' } })\n</script>`,
    )
    const options = resolveOptions({}, root)
    const cache = createScanCache()

    const first = await scanPages(options, cache)
    expect(first.routes[0].meta.style).toEqual({ navigationBarTitleText: 'First' })
    expect(cache.files.size).toBe(1)

    const second = await scanPages(options, cache)
    expect(second.routes).toEqual(first.routes)

    await writePage(
      root,
      'src/pages/index/index.vue',
      `<script setup lang="ts">\ndefinePage({ style: { navigationBarTitleText: 'Second' } })\n</script>`,
    )
    const third = await scanPages(options, cache)
    expect(third.routes[0].meta.style).toEqual({ navigationBarTitleText: 'Second' })

    await rm(join(root, 'src/pages/index/index.vue'))
    const fourth = await scanPages(options, cache)
    expect(fourth.routes).toEqual([])
    expect(cache.files.size).toBe(0)
  })
})

describe('pages.json generation', () => {
  test('preserves manual pages, excluded pages, startup page, and unmanaged sub-packages', () => {
    const current: PagesConfig = {
      pages: [
        { path: 'manual/about' },
        { path: 'pages/old' },
        { path: 'pages/legacy/keep', style: { navigationBarTitleText: 'Keep' } },
      ],
      subPackages: [{ root: 'other', pages: [{ path: 'index' }] }],
      globalStyle: { navigationBarTitleText: 'Existing' },
    }
    const input = manifest([route('pages/index/index')])
    input.excludedPaths = ['pages/legacy/keep']

    const result = mergePagesConfig(current, input, { merge: true, sort: undefined })
    expect(result.pages?.map(item => item.path)).toEqual([
      'manual/about',
      'pages/index/index',
      'pages/legacy/keep',
    ])
    expect(result.subPackages).toEqual(current.subPackages)
    expect(result.globalStyle).toEqual(current.globalStyle)
  })

  test('keeps the homepage first even when an existing startup page is preserved', () => {
    const current: PagesConfig = {
      pages: [{ path: 'manual/about' }],
      globalStyle: { navigationBarTitleText: 'Existing' },
    }
    const routes = [route('pages/home/index'), route('pages/user/detail')]
    routes[0].homepage = true

    const result = mergePagesConfig(current, manifest(routes), { merge: true, sort: undefined })
    expect(result.pages?.map(item => item.path)).toEqual([
      'pages/home/index',
      'pages/user/detail',
      'manual/about',
    ])
    expect(result.pages?.[0]).toEqual({ path: 'pages/home/index' })
  })

  test('orders page and tabBar fields with path first then alphabetically', () => {
    const current: PagesConfig = {
      pages: [{ style: { navigationBarTitleText: 'Manual' }, path: 'manual/about' }],
      tabBar: {
        color: '#333333',
        list: [{ text: 'About', pagePath: 'manual/about', iconPath: 'about.png' }],
      },
    }
    const routes = [route('pages/index/index')]
    routes[0].page = {
      style: { navigationBarTitleText: 'Home' },
      path: 'pages/index/index',
    }
    routes[0].tabBar = { text: 'Home', iconPath: 'home.png', selectedIconPath: 'home-active.png' }

    const result = mergePagesConfig(current, manifest(routes), { merge: true, sort: undefined })
    const generatedPage = result.pages?.find(page => page.path === 'pages/index/index')
    const manualPage = result.pages?.find(page => page.path === 'manual/about')
    expect(Object.keys(generatedPage ?? {})).toEqual(['path', 'style'])
    expect(Object.keys(manualPage ?? {})).toEqual(['path', 'style'])
    expect(Object.keys(result.tabBar?.list?.[0] ?? {})).toEqual([
      'pagePath',
      'iconPath',
      'selectedIconPath',
      'text',
    ])
    expect(Object.keys(result.tabBar?.list?.[1] ?? {})).toEqual(['pagePath', 'iconPath', 'text'])
  })

  test('serializes page and tabBar fields in path-first order', async () => {
    const root = await fixture()
    const options = resolveOptions({}, root)
    await mkdir(dirname(options.pagesJson), { recursive: true })
    await writeFile(
      options.pagesJson,
      `{
  "pages": [
    {
      "style": { "navigationBarTitleText": "Home" },
      "path": "pages/index/index"
    }
  ],
  "tabBar": {
    "list": [
      { "text": "Home", "iconPath": "home.png", "pagePath": "pages/index/index" }
    ]
  }
}`,
      'utf8',
    )
    const routes = [route('pages/index/index')]
    routes[0].page = { style: { navigationBarTitleText: 'Home' }, path: 'pages/index/index' }
    routes[0].tabBar = { text: 'Home', iconPath: 'home.png' }

    const result = await updatePagesJson(options, manifest(routes))
    expect(result.content).toMatch(/"path": "pages\/index\/index"[\s\S]*"style"/)
    expect(result.content).toMatch(
      /"pagePath": "pages\/index\/index"[\s\S]*"iconPath"[\s\S]*"text"/,
    )
  })

  test('generates uni-app conditional compilation comments for pages and tabBar', async () => {
    const root = await fixture()
    const options = resolveOptions({}, root)
    await mkdir(dirname(options.pagesJson), { recursive: true })
    await writeFile(options.pagesJson, `{\n  "pages": []\n}`, 'utf8')
    const routes = [route('pages/index/index'), route('pages/mine/index')]
    routes[0].tabBar = { text: 'Home' }
    routes[1].ifdef = ['WEB']
    routes[1].ifndef = ['MP-WEIXIN']
    routes[1].tabBar = { text: 'Mine' }

    const first = await updatePagesJson(options, manifest(routes))
    expect(first.content.indexOf('// #ifdef WEB')).toBeLessThan(
      first.content.indexOf('"path": "pages/mine/index"'),
    )
    expect(first.content.match(/\/\/ #ifdef WEB/g)).toHaveLength(2)
    expect(first.content.match(/\/\/ #ifndef MP-WEIXIN/g)).toHaveLength(2)
    expect(first.content.match(/\/\/ #endif/g)).toHaveLength(4)
    expect(first.content).not.toContain('"ifdef"')
    expect(first.content).not.toContain('"ifndef"')

    const second = await updatePagesJson(options, manifest(routes))
    expect(second.changed).toBe(false)
    expect(second.content).toBe(first.content)
  })

  test('keeps following entries intact when adding comments to compact JSON', async () => {
    const root = await fixture()
    const options = resolveOptions({}, root)
    await mkdir(dirname(options.pagesJson), { recursive: true })
    await writeFile(options.pagesJson, '{"pages":[]}', 'utf8')
    const routes = [route('pages/index/index'), route('pages/mine/index')]
    routes[1].ifdef = ['WEB']

    const result = await updatePagesJson(options, manifest(routes))
    expect(result.content).toMatch(/\/\/ #endif\n/)
    expect(result.content).not.toMatch(/\/\/ #endif[^\n]/)
  })

  test('updates JSONC idempotently while retaining comments and unknown fields', async () => {
    const root = await fixture()
    const options = resolveOptions({}, root)
    await mkdir(dirname(options.pagesJson), { recursive: true })
    await writeFile(
      options.pagesJson,
      `{\n  // retain this comment\n  "pages": [],\n  "custom": { "enabled": true }\n}`,
      'utf8',
    )

    const first = await updatePagesJson(options, manifest([route('pages/index/index')]))
    const second = await updatePagesJson(options, manifest([route('pages/index/index')]))
    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(second.content).toBe(first.content)
    expect(first.content).toContain('// retain this comment')
    expect(first.content).toContain('"custom"')
    expect(await readFile(options.pagesJson, 'utf8')).toBe(first.content)
  })

  test('adds pages and sub-packages to an existing empty JSON object', async () => {
    const root = await fixture()
    const options = resolveOptions({}, root)
    await mkdir(dirname(options.pagesJson), { recursive: true })
    await writeFile(options.pagesJson, '{}', 'utf8')
    const routes = [route('pages/index/index'), route('shop/cart', {}, 'shop')]

    const result = await updatePagesJson(options, manifest(routes))
    const parsed = JSON.parse(result.content) as PagesConfig
    expect(parsed.pages).toEqual([{ path: 'pages/index/index' }])
    expect(parsed.subPackages).toEqual([{ root: 'shop', pages: [{ path: 'cart' }] }])
  })

  test('removes managed sub-packages that no longer contain pages', () => {
    const current: PagesConfig = {
      pages: [{ path: 'pages/index/index' }],
      subPackages: [{ root: 'shop', pages: [{ path: 'cart' }] }],
    }
    const input = manifest([route('pages/index/index')])
    input.managedSubPackageRoots = ['shop']

    const result = mergePagesConfig(current, input, { merge: true, sort: undefined })
    expect(result.subPackages).toBeUndefined()
  })

  test('removes stale subPackages from pages.json when merge is false', async () => {
    const root = await fixture()
    const options = resolveOptions({ merge: false }, root)
    await mkdir(dirname(options.pagesJson), { recursive: true })
    await writeFile(
      options.pagesJson,
      `{\n  "pages": [{ "path": "pages/index/index" }],\n  "subPackages": [{ "root": "shop", "pages": [{ "path": "cart" }] }]\n}`,
      'utf8',
    )

    const result = await updatePagesJson(options, manifest([route('pages/index/index')]))
    const parsed = JSON.parse(result.content) as PagesConfig
    expect(parsed.subPackages).toBeUndefined()

    const second = await updatePagesJson(options, manifest([route('pages/index/index')]))
    expect(second.changed).toBe(false)
    expect(second.content).toBe(result.content)
  })

  test('refuses to remove a page still referenced by tabBar', () => {
    const current: PagesConfig = {
      pages: [{ path: 'pages/index/index' }],
      tabBar: { list: [{ pagePath: 'pages/index/index', text: 'Home' }] },
    }
    expect(() => mergePagesConfig(current, manifest([]), { merge: true, sort: undefined })).toThrow(
      'tabBar references removed page',
    )
  })

  test('merges page-level tabBar into the root list with index ordering', () => {
    const current: PagesConfig = {
      pages: [{ path: 'pages/index/index' }, { path: 'manual/about' }],
      tabBar: { color: '#333333', list: [{ pagePath: 'manual/about', text: 'About' }] },
    }
    const routes = [route('pages/index/index'), route('pages/user/detail')]
    routes[0].tabBar = { text: 'Home', index: 1 }
    routes[1].tabBar = { text: 'Detail', index: 0 }

    const result = mergePagesConfig(current, manifest(routes), { merge: true, sort: undefined })
    expect(result.tabBar?.color).toBe('#333333')
    expect(result.tabBar?.list).toEqual([
      { text: 'Detail', pagePath: 'pages/user/detail' },
      { text: 'Home', pagePath: 'pages/index/index' },
      { pagePath: 'manual/about', text: 'About' },
    ])
  })

  test('preserves existing tabBar entries for pages that still exist', () => {
    const current: PagesConfig = {
      pages: [
        { path: 'pages/index/index' },
        { path: 'pages/mine/index' },
        { path: 'manual/about' },
      ],
      tabBar: {
        list: [
          { pagePath: 'pages/index/index', text: 'Home' },
          { pagePath: 'pages/mine/index', text: 'Mine' },
          { pagePath: 'manual/about', text: 'About' },
        ],
      },
    }
    const routes = [route('pages/index/index'), route('pages/mine/index')]
    routes[0].tabBar = { text: 'Home' }

    const result = mergePagesConfig(current, manifest(routes), { merge: true, sort: undefined })
    expect(result.tabBar?.list).toEqual([
      { text: 'Home', pagePath: 'pages/index/index' },
      { pagePath: 'pages/mine/index', text: 'Mine' },
      { pagePath: 'manual/about', text: 'About' },
    ])
  })

  test('preserves manually added tabBar entries for managed pages', () => {
    const current: PagesConfig = {
      pages: [{ path: 'pages/index/index' }, { path: 'pages/mine/index' }],
      tabBar: {
        list: [
          { pagePath: 'pages/index/index', text: 'Home' },
          { pagePath: 'pages/mine/index', text: '我的的详情' },
        ],
      },
    }
    const routes = [route('pages/index/index'), route('pages/mine/index')]
    routes[0].tabBar = { text: 'Home' }

    const result = mergePagesConfig(current, manifest(routes), { merge: true, sort: undefined })
    expect(result.tabBar?.list).toEqual([
      { text: 'Home', pagePath: 'pages/index/index' },
      { pagePath: 'pages/mine/index', text: '我的的详情' },
    ])
  })

  test('keeps existing tabBar entries on subsequent page updates', async () => {
    const root = await fixture()
    const options = resolveOptions({}, root)
    await mkdir(dirname(options.pagesJson), { recursive: true })
    const routes = [route('pages/index/index'), route('pages/mine/index')]
    routes[0].tabBar = { text: 'Home' }
    routes[1].tabBar = { text: 'Mine' }

    const first = await updatePagesJson(options, manifest(routes))
    expect((JSON.parse(first.content) as PagesConfig).tabBar?.list).toEqual([
      { text: 'Home', pagePath: 'pages/index/index' },
      { text: 'Mine', pagePath: 'pages/mine/index' },
    ])

    routes[1].tabBar = undefined
    const second = await updatePagesJson(options, manifest(routes))
    expect(second.changed).toBe(false)
    expect((JSON.parse(second.content) as PagesConfig).tabBar?.list).toEqual([
      { text: 'Home', pagePath: 'pages/index/index' },
      { text: 'Mine', pagePath: 'pages/mine/index' },
    ])
  })

  test('drops managed tabBar entries when their page is removed', () => {
    const current: PagesConfig = {
      pages: [{ path: 'pages/index/index' }, { path: 'pages/user/detail' }],
      tabBar: { list: [{ pagePath: 'pages/index/index', text: 'Home' }] },
    }
    const routes = [route('pages/user/detail')]
    routes[0].tabBar = { text: 'Detail' }

    const result = mergePagesConfig(current, manifest(routes), { merge: true, sort: undefined })
    expect(result.tabBar?.list).toEqual([{ text: 'Detail', pagePath: 'pages/user/detail' }])
  })

  test('strictly syncs tabBar list when merge is false', () => {
    const current: PagesConfig = {
      pages: [{ path: 'pages/index/index' }, { path: 'manual/about' }],
      tabBar: {
        color: '#333333',
        list: [
          { pagePath: 'pages/index/index', text: 'Old' },
          { pagePath: 'manual/about', text: 'About' },
        ],
      },
    }
    const routes = [route('pages/index/index'), route('pages/mine/index')]
    routes[0].tabBar = { text: 'Home' }
    routes[1].tabBar = { text: 'Mine' }

    const result = mergePagesConfig(current, manifest(routes), { merge: false, sort: undefined })
    expect(result.tabBar).toEqual({
      color: '#333333',
      list: [
        { text: 'Home', pagePath: 'pages/index/index' },
        { text: 'Mine', pagePath: 'pages/mine/index' },
      ],
    })
  })

  test('removes tabBar when merge is false and no page declares tabBar', () => {
    const current: PagesConfig = {
      pages: [{ path: 'pages/index/index' }, { path: 'pages/user/detail' }],
      tabBar: { list: [{ pagePath: 'pages/user/detail', text: 'Detail' }] },
    }

    const result = mergePagesConfig(current, manifest([route('pages/index/index')]), {
      merge: false,
      sort: undefined,
    })
    expect(result.tabBar).toBeUndefined()
  })

  test('removes tabBar from pages.json when merge is false and no tabBar pages exist', async () => {
    const root = await fixture()
    const options = resolveOptions({ merge: false }, root)
    await mkdir(dirname(options.pagesJson), { recursive: true })
    await writeFile(
      options.pagesJson,
      `{\n  "pages": [{ "path": "pages/index/index" }, { "path": "pages/user/detail" }],\n  "tabBar": { "list": [{ "pagePath": "pages/user/detail", "text": "Detail" }] }\n}`,
      'utf8',
    )

    const result = await updatePagesJson(options, manifest([route('pages/index/index')]))
    const parsed = JSON.parse(result.content) as PagesConfig
    expect(parsed.tabBar).toBeUndefined()
  })

  test('persists page-level tabBar and keeps manual list entries', async () => {
    const root = await fixture()
    const options = resolveOptions({}, root)
    await mkdir(dirname(options.pagesJson), { recursive: true })
    await writeFile(
      options.pagesJson,
      `{\n  "pages": [{ "path": "manual/about" }],\n  "tabBar": {\n    "color": "#333333",\n    "list": [{ "pagePath": "manual/about", "text": "About" }]\n  }\n}`,
      'utf8',
    )
    const routes = [route('pages/index/index'), route('pages/user/detail')]
    routes[0].tabBar = { text: 'Home', index: 1 }
    routes[1].tabBar = { text: 'Detail', index: 0 }

    const first = await updatePagesJson(options, manifest(routes))
    const parsed = JSON.parse(first.content) as PagesConfig
    expect(parsed.tabBar?.color).toBe('#333333')
    expect(parsed.tabBar?.list).toEqual([
      { text: 'Detail', pagePath: 'pages/user/detail' },
      { text: 'Home', pagePath: 'pages/index/index' },
      { pagePath: 'manual/about', text: 'About' },
    ])
    const second = await updatePagesJson(options, manifest(routes))
    expect(second.changed).toBe(false)
    expect(second.content).toBe(first.content)
  })
})

describe('declaration and virtual module generation', () => {
  test('generates route declarations and runtime data from one manifest', () => {
    const routes = [
      route('pages/index/index'),
      route('pages/user/detail', {
        id: { type: 'number', required: true },
        preview: { type: 'boolean', required: false },
        obj: { type: 'object', required: false },
      }),
    ]
    routes[1].queryTypes = { obj: '{ a: number }' }
    const config: PagesConfig = {
      pages: routes.map(item => item.page),
      tabBar: { list: [{ pagePath: 'pages/index/index', text: 'Home' }] },
    }

    expect(runtimeRoutes(routes, config).map(item => item.tab)).toEqual([true, false])
    expect(runtimeRoutes(routes, config)[0]).not.toHaveProperty('file')
    const declarations = generateDeclarations(routes, config)
    expect(declarations).toContain('/* eslint-disable */')
    expect(declarations).toContain('/* oxlint-disable */')
    expect(declarations).toContain('/* prettier-ignore */\ndeclare module')
    expect(declarations).toContain('// @ts-nocheck')
    expect(declarations).toContain('// biome-ignore-all lint: generated file')
    expect(declarations).toContain('// dprint-ignore-file')
    expect(declarations).toContain('"/pages/user/detail"')
    expect(declarations).toContain('"id": number')
    expect(declarations).toContain('"preview"?: boolean')
    expect(declarations).toContain('"obj"?: { a: number }')
    expect(declarations).toContain('query: Record<string, never>')
    expect(declarations).toContain('tab: true')
    expect(declarations).toContain('import type { PageMeta }')
    expect(declarations).toContain('meta: PageMeta')
    expect(declarations).not.toContain('src/pages/user/detail.vue')
    const virtualModule = generateVirtualModule(routes, config)
    expect(virtualModule).toContain('export const routes')
    expect(virtualModule).toContain('JSON.parse')
    expect(virtualModule).not.toContain('src/pages/user/detail.vue')
    expect(virtualModule).not.toContain('registerUniRoutes')
  })
})

describe('runtime navigation and query parsing', () => {
  function mockUni() {
    const methods = {
      navigateTo: vi.fn<() => void>(),
      redirectTo: vi.fn<() => void>(),
      reLaunch: vi.fn<() => void>(),
      switchTab: vi.fn<() => void>(),
    }
    vi.stubGlobal('uni', methods)
    return methods
  }

  test('serializes typed query values and parses onLoad values', () => {
    const uni = mockUni()
    navigateTo('/pages/user/detail', { id: 42, preview: false })
    expect(uni.navigateTo).toHaveBeenCalledWith({ url: '/pages/user/detail?id=42&preview=false' })
    expect(parseQuery('/pages/user/detail', { id: '42', preview: 'false' })).toEqual({
      id: 42,
      preview: false,
    })
  })

  test('returns navigation target info from navigation APIs', () => {
    const uni = mockUni()
    const info = navigateTo('/pages/user/detail', { id: 42 })
    expect(info).toMatchObject({
      method: 'navigateTo',
      path: '/pages/user/detail',
      url: '/pages/user/detail?id=42',
      query: { id: '42' },
      meta: {},
      tab: false,
    })

    const tab = switchTab('/pages/index/index')
    expect(tab).toMatchObject({
      method: 'switchTab',
      path: '/pages/index/index',
      url: '/pages/index/index',
      tab: true,
    })
    expect(uni.navigateTo).toHaveBeenCalledTimes(1)
    expect(uni.switchTab).toHaveBeenCalledTimes(1)
  })

  test('parses page props once and returns a read-only cache', () => {
    const props: Record<string, unknown> = { id: '42', preview: 'false' }
    const format = vi.fn<(value: string) => boolean>(value => JSON.parse(value) as boolean)
    const query = usePageQuery<{
      id: NumberConstructor
      preview: { type: BooleanConstructor; required: false }
    }>(props, {
      id: { type: 'number', required: true },
      preview: { type: 'boolean', required: false, format },
    })
    expect(query.id).toBe(42)
    expect(query.preview).toBe(false)
    expect(query.preview).toBe(false)
    expect(format).toHaveBeenCalledTimes(1)
    expect(Object.isFrozen(query)).toBe(true)
    const descriptor = Object.getOwnPropertyDescriptor(query, 'id')
    expect(descriptor?.get).toBeUndefined()
    expect(descriptor?.value).toBe(42)
    expect(descriptor?.writable).toBe(false)

    props.id = '43'
    expect(query.id).toBe(42)
    expect(Reflect.set(query, 'id', 43)).toBe(false)
    expect(query.id).toBe(42)
    expect(() => usePageQuery({}, { id: { type: 'number', required: true } })).toThrow(
      'Missing required query',
    )
  })

  test('returns plain data objects from parseQuery', () => {
    const parsed = parseQuery('/pages/user/detail', { id: '42', preview: 'false' })
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    const descriptor = Object.getOwnPropertyDescriptor(parsed, 'id')
    expect(descriptor).toMatchObject({
      configurable: true,
      enumerable: true,
      value: 42,
      writable: true,
    })
    expect(descriptor?.get).toBeUndefined()
  })

  test('rejects __proto__ query names from runtime schemas', () => {
    const schema = JSON.parse(
      '{"__proto__":{"type":"string","required":true}}',
    ) as NormalizedQuerySchema
    const props = JSON.parse('{"__proto__":"value"}') as Record<string, unknown>
    expect(() => usePageQuery(props, schema)).toThrow(
      'Query parameter name "__proto__" is not supported',
    )
  })

  test('parses and serializes object query values as JSON', () => {
    const uni = mockUni()
    navigateTo('/pages/object', { obj: { a: 1 } })
    expect(uni.navigateTo).toHaveBeenCalledWith({ url: '/pages/object?obj=%7B%22a%22%3A1%7D' })
    const query = usePageQuery<{ obj: QueryType<{ a: number }> }>(
      { obj: '{"a":1}' },
      {
        obj: { type: 'object', required: true },
      },
    )
    expect(query.obj).toEqual({ a: 1 })
    expect(() => usePageQuery({ obj: '1' }, { obj: { type: 'object', required: true } })).toThrow(
      'must be an object',
    )
  })

  test('URL-encodes query names and values', () => {
    const uni = mockUni()
    const obj = { text: 'a&b #c?d=e', nested: { value: 1 } }
    navigateTo('/pages/object', { obj })
    expect(uni.navigateTo).toHaveBeenCalledWith({
      url: `/pages/object?obj=${encodeURIComponent(JSON.stringify(obj))}`,
    })
  })

  test('reports invalid JSON and unserializable objects with path context', () => {
    expect(() => parseQuery('/pages/object', { obj: '{invalid' })).toThrow(
      '/pages/object: Query parameter "obj" must be valid JSON',
    )

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => navigateTo('/pages/object', { obj: circular })).toThrow(
      'Query parameter "obj" must be JSON serializable',
    )
  })

  test('decodes URL-encoded values before parsing and formatting', () => {
    const query = usePageQuery<{
      text: StringConstructor
      obj: QueryType<{ a: number }>
    }>(
      { text: 'hello%20world', obj: '%7B%22a%22%3A2%7D' },
      {
        text: { type: 'string', required: true },
        obj: { type: 'object', required: true, format: JSON.parse },
      },
    )
    expect(query.text).toBe('hello world')
    expect(query.obj).toEqual({ a: 2 })
  })

  test('supports custom formatters and validates their return values', () => {
    const query = usePageQuery<{ id: NumberConstructor }>(
      { id: '41' },
      {
        id: { type: 'number', required: true, format: value => Number(value) + 1 },
      },
    )
    expect(query.id).toBe(42)
    expect(() =>
      usePageQuery(
        { id: '1' },
        {
          id: { type: 'number', required: true, format: () => 'invalid' },
        },
      ),
    ).toThrow('must be number')
  })

  test('validates missing, unknown, and invalid query values', () => {
    expect(() => (navigateTo as (url: string) => void)('/pages/user/detail')).toThrow(
      'Missing required query',
    )
    expect(() => navigateTo('/pages/user/detail', { id: Number.POSITIVE_INFINITY })).toThrow(
      'must be number',
    )
    expect(() => navigateTo('/pages/user/detail', { id: 1, extra: 'x' } as never)).toThrow(
      'Unknown query parameter',
    )
    expect(() => parseQuery('/pages/user/detail', { id: 'not-a-number' })).toThrow('finite number')
    expect(() => parseQuery('/pages/user/detail', { id: '1', preview: 'yes' })).toThrow(
      'true or false',
    )
  })

  test('restricts switchTab to registered tab pages without query', () => {
    const uni = mockUni()
    switchTab('/pages/index/index')
    expect(uni.switchTab).toHaveBeenCalledWith({ url: '/pages/index/index' })
    expect(() => switchTab('/pages/user/detail' as never)).toThrow('not a tabBar page')
    expect(() => switchTab('/pages/index/index', { query: {} } as never)).toThrow(
      'does not support query',
    )
  })
})
