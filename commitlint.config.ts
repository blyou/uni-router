import { UserConfig } from '@commitlint/types'

export default {
  // 继承 Conventional Commits 预设（已内置 type/scope/subject 等基础规则）
  extends: ['@commitlint/config-conventional'],
} satisfies UserConfig
