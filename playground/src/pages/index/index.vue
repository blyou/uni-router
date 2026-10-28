<script setup lang="ts">
import { navigateTo } from '@blyou/uni-router'

definePage({
  homepage: true,
  tabBar: {
    iconPath: '/static/logo.png',
    text: '首页',
    index: 0,
  },
  style: { navigationBarTitleText: 'uni-router' },
})
</script>

<template>
  <view class="content">
    <text class="title">uni-router</text>
    <button
      class="detail-button"
      @click="
        navigateTo('/pages/user/detail', {
          id: 42,
          preview: true,
          obj: { a: 1, b: 'demo', c: true },
        })
      "
    >
      查看用户详情
    </button>
    <button
      class="detail-button"
      @click="
        navigateTo(
          // @ts-expect-error
          '/pages/unknown',
          { test: '测试' },
        )
      "
    >
      跳转到未注册页面
    </button>
  </view>
</template>

<style scoped>
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  gap: 40rpx;
}

.title {
  font-size: 42rpx;
  color: #2c3e50;
}

.detail-button {
  font-size: 30rpx;
}
</style>
