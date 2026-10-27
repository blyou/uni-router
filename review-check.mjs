import UniRouter from './dist/index.mjs'
const plugin = UniRouter({ watch: false })
for (const source of [
  `import { definePage, navigateTo } from '@blyou/uni-router'\ndefinePage({})`,
  `import { navigateTo, definePage } from '@blyou/uni-router'\ndefinePage({})`,
  `import { definePage, navigateTo, parseQuery } from '@blyou/uni-router'\ndefinePage({})`,
  `import { definePage as page, navigateTo } from '@blyou/uni-router'\npage({})`,
]) {
  const code = `<script setup lang="ts">\n${source}\n</script>`
  try { console.log('---\n' + plugin.transform(code, '/tmp/Page.vue').code) } catch (e) { console.log('ERR', e.message) }
}
