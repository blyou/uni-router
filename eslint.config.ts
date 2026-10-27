import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginOxlint from 'eslint-plugin-oxlint'
import skipFormatting from 'eslint-config-prettier/flat'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  ...pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),

  skipFormatting,

  {
    rules: {
      // 'vue/require-default-prop': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/html-self-closing': ['error', { html: { void: 'always' } }],
      'vue/multiline-html-element-content-newline': 'error',
      'vue/prefer-template': 'error',
      'vue/block-order': [
        'error',
        {
          order: [
            'script:not([setup])',
            'script[setup]',
            'template',
            'style:not([scoped])',
            'style[scoped]',
          ],
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-template': 'error',
      '@typescript-eslint/no-unused-expressions': ['error', { allowTaggedTemplates: true }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // {
  //   files: ['**/components/**/*.vue'],
  //   rules: {
  //     'vue/multi-word-component-names': 'error',
  //   },
  // },
)
