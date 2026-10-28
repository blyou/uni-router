import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import UniRouter from '../src/index'

const virtualId = '@blyou/uni-router/auto-routes'
const resolvedVirtualId = `\0${virtualId}`

const temporaryDirectories: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'uni-router-plugin-'))
  temporaryDirectories.push(root)
  return root
}

async function writePage(root: string, file: string, content = '<template><view /></template>') {
  const target = join(root, file)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
}

async function until(predicate: () => boolean, timeout = 30_000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})

describe('vite plugin hooks', () => {
  test('keeps dev-server watching, hmr, and build watch in sync with the manifest', async () => {
    const root = await fixture()
    await writePage(root, 'src/pages/index/index.vue')

    const plugin = UniRouter() as Record<string, any>
    const config: Record<string, any> = { root }
    await plugin.config(config, { command: 'serve', mode: 'development' })
    expect(config.optimizeDeps.exclude).toEqual([virtualId, '@blyou/uni-router'])

    const addWatchFile = vi.fn<(id: string) => void>()
    await plugin.buildStart.call({ addWatchFile })
    expect(addWatchFile).toHaveBeenCalledWith(expect.stringContaining('pages.json'))

    expect(plugin.resolveId(virtualId)).toBe(resolvedVirtualId)
    const load = () => plugin.load(resolvedVirtualId) as string
    expect(load()).toContain('/pages/index/index')

    const watchHandlers: Record<string, (file: string) => void> = {}
    const server = {
      watcher: {
        add: vi.fn<(paths: string[]) => void>(),
        on: vi.fn<(event: string, handler: (file: string) => void) => void>((event, handler) => {
          watchHandlers[event] = handler
        }),
      },
      ws: { send: vi.fn<(payload: unknown) => void>() },
      moduleGraph: {
        getModuleById: vi.fn<(id: string) => unknown>(() => ({ id: resolvedVirtualId })),
        invalidateModule: vi.fn<(module: unknown) => void>(),
      },
      config: { logger: { error: vi.fn<(message: unknown) => void>() } },
    }
    plugin.configureServer(server)
    expect(server.watcher.add).toHaveBeenCalled()

    // watcher add -> regenerate, invalidate, and full reload
    await writePage(root, 'src/pages/about/index.vue')
    watchHandlers.add(join(root, 'src/pages/about/index.vue'))
    await until(() => load().includes('/pages/about/index'))
    expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload', path: '*' })
    expect(server.moduleGraph.invalidateModule).toHaveBeenCalled()
    const reloadCount = server.ws.send.mock.calls.length

    // watcher change on an unchanged pages.json -> ignored
    watchHandlers.change(join(root, 'src/pages.json'))
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(server.ws.send.mock.calls.length).toBe(reloadCount)

    // watcher change on a modified pages.json -> reload
    const pagesJson = join(root, 'src/pages.json')
    await writeFile(pagesJson, `${await readFile(pagesJson, 'utf8')}\n`, 'utf8')
    watchHandlers.change(pagesJson)
    await until(() => server.ws.send.mock.calls.length > reloadCount)

    // hmr on an unchanged page -> default hmr preserved
    const hmrContext = { file: join(root, 'src/pages/about/index.vue') }
    expect(await plugin.handleHotUpdate(hmrContext)).toBeUndefined()

    // hmr on a changed page -> swallowed and manifest refreshed
    await writePage(
      root,
      'src/pages/about/index.vue',
      `<script setup lang="ts">\ndefinePage({ style: { navigationBarTitleText: 'About' } })\n</script>\n<template><view /></template>`,
    )
    expect(await plugin.handleHotUpdate(hmrContext)).toEqual([])
    await until(() => load().includes('navigationBarTitleText'))

    // transform still rewrites the query macro
    const transformed = await plugin.transform(
      `<script setup lang="ts">\nconst query = definePage({ query: { id: Number } })\n</script>`,
      join(root, 'src/pages/detail.vue'),
    )
    expect(transformed.code).toContain('defineProps')
    expect(transformed.code).not.toContain('definePage')

    // build-mode watchChange regenerates without a dev server
    const buildPlugin = UniRouter() as Record<string, any>
    await buildPlugin.config({ root }, { command: 'build', mode: 'production' })
    await buildPlugin.buildStart.call({ addWatchFile: vi.fn<(id: string) => void>() })
    await writePage(root, 'src/pages/other/index.vue')
    await buildPlugin.watchChange(join(root, 'src/pages/other/index.vue'))
    expect(buildPlugin.load(resolvedVirtualId)).toContain('/pages/other/index')

    // irrelevant files stay ignored
    const before = buildPlugin.load(resolvedVirtualId) as string
    await writePage(root, 'src/components/nope.txt')
    await buildPlugin.watchChange(join(root, 'src/components/nope.txt'))
    expect(buildPlugin.load(resolvedVirtualId)).toBe(before)
  }, 120_000)
})
