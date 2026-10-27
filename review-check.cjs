const { parse } = require('@vue/compiler-sfc')
const src = `<template><view/></template>
<script setup lang="ts">
const x=1
</script>`
const r = parse(src)
console.log(r.descriptor.scriptSetup.loc.start)
console.log(JSON.stringify(r.descriptor.scriptSetup.content))
console.log(src.indexOf(r.descriptor.scriptSetup.content, r.descriptor.scriptSetup.loc.start.offset))
