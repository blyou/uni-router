<script setup lang="ts">
import { switchTab } from '@blyou/uni-router'

const query = definePage({
  style: { navigationBarTitleText: '页面不存在' },
  query: {
    path: { type: String, required: false },
  },
})

function goHome() {
  switchTab('/pages/index/index')
}
</script>

<template>
  <view class="content">
    <text class="code">404</text>
    <text class="title">页面不存在</text>
    <text v-if="query.path" class="desc">未找到路由：{{ query.path }}</text>
    <text v-else class="desc">请检查访问地址是否正确</text>
    <button class="home" @click="goHome">返回首页</button>
  </view>
</template>

<style scoped>
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
  gap: 24rpx;
  padding: 40rpx;
}

.code {
  font-size: 120rpx;
  font-weight: 700;
  color: #2c3e50;
}

.title {
  font-size: 40rpx;
  font-weight: 600;
  color: #2c3e50;
}

.desc {
  font-size: 26rpx;
  color: #909399;
  word-break: break-all;
  text-align: center;
}

.home {
  margin-top: 20rpx;
  font-size: 30rpx;
}
</style>
