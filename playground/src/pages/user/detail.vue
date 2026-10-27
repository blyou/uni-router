<script setup lang="ts">
import { type QueryType } from '@blyou/uni-router'

const query = definePage({
  style: { navigationBarTitleText: '用户详情' },
  query: {
    id: Number,
    preview: { type: Boolean, required: false },
    obj: { type: Object as QueryType<{ a: number; b: string; c: boolean }> },
  },
})

console.log('query', query)
</script>

<template>
  <view class="content">
    <text class="title">用户详情</text>
    <text>用户 ID：{{ query.id }}</text>
    <text>预览模式：{{ query.preview ? '是' : '否' }}</text>
    <text>对象参数：{{ query.obj.a }} / {{ query.obj.b }} / {{ query.obj.c }}</text>
  </view>
</template>

<style scoped>
.content {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  padding: 40rpx;
}

.title {
  font-size: 38rpx;
  font-weight: 600;
}
</style>
