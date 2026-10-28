import MagicString from 'magic-string'
import { analyzePage, runtimeModule } from './analyzer'
import type { PageMacroAnalysis } from './analyzer'
import type { SfcParser } from './sfc'
import type { NormalizedQuerySchema } from './types'

interface GeneratedNames {
  pageProps: string
  usePageQuery: string
}

const whitespaceRE = /\s/
const spacesAndTabsRE = /[ \t]/

function uniqueIdentifier(code: string, base: string) {
  let name = base
  let index = 1
  while (new RegExp(`\\b${name}\\b`).test(code)) name = `${base}${index++}`
  return name
}

function firstToken(code: string, offset: number) {
  let index = offset
  while (index < code.length && whitespaceRE.test(code[index])) index++
  return index
}

function generatedNames(code: string): GeneratedNames {
  return {
    pageProps: uniqueIdentifier(code, '__uniRouterPageProps'),
    usePageQuery: uniqueIdentifier(code, '__uniRouterUsePageQuery'),
  }
}

function querySchema(analysis: PageMacroAnalysis) {
  const schema: NormalizedQuerySchema = analysis.query ?? {}
  const formats = analysis.formats ?? {}
  return Object.entries(schema).map(([name, field]) => {
    const format = Object.hasOwn(formats, name) ? `, format: ${formats[name]}` : ''
    return `${JSON.stringify(name)}: { type: ${JSON.stringify(field.type)}, required: ${field.required}${format} }`
  })
}

function propSchema(analysis: PageMacroAnalysis) {
  const schema: NormalizedQuerySchema = analysis.query ?? {}
  return Object.entries(schema).map(
    ([name, field]) => `${JSON.stringify(name)}: { type: String, required: ${field.required} }`,
  )
}

function pageQuery(variable: string, analysis: PageMacroAnalysis, names: GeneratedNames) {
  const props = propSchema(analysis)
  const entries = querySchema(analysis)
  return [
    `const ${names.pageProps} = defineProps({ ${props.join(', ')} })`,
    `const ${variable} = ${names.usePageQuery}(${names.pageProps}, { ${entries.join(', ')} })`,
    '',
  ].join('\n')
}

function runtimeImports(names: GeneratedNames) {
  return [`import { usePageQuery as ${names.usePageQuery} } from '${runtimeModule}'`, ''].join('\n')
}

function removeImportSpecifiers(code: string, magic: MagicString, analysis: PageMacroAnalysis) {
  for (const declaration of analysis.imports) {
    if (declaration.removeAll) {
      magic.remove(declaration.start, declaration.end)
      continue
    }
    for (const specifier of [...declaration.specifiers].sort((a, b) => b.start - a.start)) {
      let start = specifier.start
      let end = specifier.end
      let cursor = end
      while (cursor < code.length && spacesAndTabsRE.test(code[cursor])) cursor++
      if (code[cursor] === ',') {
        end = cursor + 1
        while (end < code.length && spacesAndTabsRE.test(code[end])) end++
      } else {
        while (start > declaration.start && spacesAndTabsRE.test(code[start - 1])) start--
        if (code[start - 1] === ',') start--
      }
      magic.remove(start, end)
    }
  }
}

export interface TransformResult {
  code: string
  map: ReturnType<MagicString['generateMap']>
}

export function transformPage(
  code: string,
  file: string,
  parseSfc?: SfcParser,
): TransformResult | undefined {
  const analysis = analyzePage(code, file, parseSfc)
  if (!analysis.calls.length) return

  const magic = new MagicString(code)
  const queryCall = analysis.calls.find(call => call.queryVariable)
  if (queryCall?.queryVariable) {
    const names = generatedNames(code)
    const insertAt =
      analysis.scriptSetupOffset == null
        ? queryCall.start
        : firstToken(code, analysis.scriptSetupOffset)
    magic.appendLeft(insertAt, runtimeImports(names))
    magic.overwrite(
      queryCall.start,
      queryCall.end,
      pageQuery(queryCall.queryVariable, analysis, names),
    )
  } else {
    for (const call of analysis.calls) magic.remove(call.start, call.end)
  }
  removeImportSpecifiers(code, magic, analysis)

  return {
    code: magic.toString(),
    map: magic.generateMap({ source: file, includeContent: true, hires: true }),
  }
}
