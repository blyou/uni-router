import { compileScript, parse } from '@vue/compiler-sfc'
import { describe, expect, test } from 'vitest'
import { analyzePage } from '../src/scanner'
import { transformPage } from '../src/transform'

function compiled(source: string, file = 'page.vue') {
  const result = transformPage(source, file)
  if (!result) throw new Error('transformPage returned no result')
  const parsed = parse(result.code, { filename: file })
  expect(parsed.errors).toEqual([])
  compileScript(parsed.descriptor, { id: 'test' })
  return result.code
}

describe('page macro transform', () => {
  test('turns the definePage result into page props and a typed query', () => {
    const code = compiled(`<script setup lang="ts">
import { definePage, navigateTo } from '@blyou/uni-router'
import type { QueryType } from '@blyou/uni-router'
const query = definePage({
  query: {
    id: Number,
    preview: { type: Boolean, required: false },
    obj: { type: Object as QueryType<{ a: number }> },
  },
})
navigateTo({ url: '/pages/index/index' })
</script>
<template><text>{{ query.id }}</text></template>`)

    expect(code).not.toContain('definePage')
    expect(code).toContain('defineProps')
    expect(code).not.toContain('__uniRouterOnLoad')
    expect(code).not.toContain('__uniRouterReactive')
    expect(code).not.toContain('Reflect.set')
    expect(code).not.toContain('validate: false')
    expect(code).toContain('import { navigateTo }')
    expect(code).toContain('import type { QueryType }')
    expect(code).toContain('usePageQuery as __uniRouterUsePageQuery')
    expect(code).toContain('"id": { type: String, required: true }')
    expect(code).toContain('"preview": { type: String, required: false }')
    expect(code).toContain('"id": { type: "number", required: true }')
  })

  test('avoids duplicate locals when runtime helpers already exist', () => {
    const code = compiled(`<script setup lang="ts">
import { definePage, usePageQuery } from '@blyou/uni-router'
import { onLoad } from '@dcloudio/uni-app'
import { reactive } from 'vue'
const query = definePage({ query: { id: Number } })
</script>`)

    expect(code.match(/import \{[^}]*usePageQuery/g)).toHaveLength(2)
    expect(code).toContain('usePageQuery as __uniRouterUsePageQuery')
    expect(code).not.toContain('__uniRouterOnLoad')
    expect(code).not.toContain('__uniRouterReactive')
  })

  test('keeps following statements when definePage and the next statement share a line', () => {
    const code = compiled(`<script setup lang="ts">
const query = definePage({ query: { id: Number } });const foo = 1
</script>`)

    expect(code).toContain('const foo = 1')
    expect(code).not.toContain('definePage')
  })

  test('removes a standalone macro without adding runtime imports', () => {
    const code = compiled(`<script setup lang="ts">
const foo = 1
definePage({ style: { navigationBarTitleText: 'Home' } })
</script>
<template><view /></template>`)

    expect(code).not.toContain('definePage')
    expect(code).not.toContain('__uniRouterUsePageQuery')
    expect(code).toContain('const foo = 1')
  })

  test('uses unique generated names when the page already declares them', () => {
    const code = compiled(`<script setup lang="ts">
const __uniRouterPageProps = 1
const __uniRouterUsePageQuery = 2
const query = definePage({ query: { id: Number } })
console.log(__uniRouterPageProps, __uniRouterUsePageQuery)
</script>`)

    expect(code).toContain('const __uniRouterPageProps1 = defineProps')
    expect(code).toContain('usePageQuery as __uniRouterUsePageQuery1')
  })
})

describe('static page analysis safety', () => {
  test('rejects __proto__ config keys', () => {
    const source = `<script setup lang="ts">
const query = definePage({
  '__proto__': 'meta',
  query: { '__proto__': String },
})
</script>`

    expect(() => analyzePage(source, 'proto.vue')).toThrow(
      'Config key "__proto__" is not supported',
    )
  })

  test('rejects combining the query sugar with an existing defineProps call', () => {
    const source = `<script setup lang="ts">
const props = defineProps({ label: String })
const query = definePage({ query: { id: Number } })
</script>`

    expect(() => analyzePage(source, 'props.vue')).toThrow(
      'definePage return value cannot be combined with defineProps',
    )
  })
})
