import uni from '@dcloudio/vite-plugin-uni'
import { defineConfig } from 'vite'
import UniRouter from '@blyou/uni-router/vite'

export default defineConfig({
  plugins: [UniRouter({ merge: false }), uni()],
})
