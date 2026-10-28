<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { navigateTo } from '@blyou/uni-router'
import { ref } from 'vue'
import { currentUser, isLoggedIn } from '../../utils/auth'

definePage({
  style: { navigationBarTitleText: '我的' },
  tabBar: {
    iconPath: '/static/logo.png',
    text: '我的',
    index: 1,
  },
})

const user = ref(currentUser())
const loggedIn = ref(false)

onShow(() => {
  loggedIn.value = isLoggedIn()
  user.value = currentUser()
})

function openProfile() {
  navigateTo('/pages/mine/profile')
}

function openLogin() {
  navigateTo('/pages/login/index')
}
</script>

<template>
  <view class="content">
    <view class="profile">
      <image class="avatar" src="/static/logo.png" />
      <view class="info">
        <text class="nickname">{{ user.nickname }}</text>
        <text class="desc">{{ loggedIn ? '已登录' : '未登录' }}</text>
      </view>
    </view>

    <view class="menu">
      <view class="menu-item" @click="openProfile">
        <text>个人信息</text>
        <text class="arrow">›</text>
      </view>
      <view class="menu-item" @click="openLogin">
        <text>{{ loggedIn ? '切换账号' : '登录' }}</text>
        <text class="arrow">›</text>
      </view>
      <view class="menu-item">
        <text>关于 uni-router</text>
        <text class="arrow">›</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.content {
  display: flex;
  flex-direction: column;
  gap: 32rpx;
  padding: 40rpx;
}

.profile {
  display: flex;
  align-items: center;
  gap: 24rpx;
}

.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
}

.info {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.nickname {
  font-size: 36rpx;
  font-weight: 600;
  color: #2c3e50;
}

.desc {
  font-size: 26rpx;
  color: #909399;
}

.menu {
  overflow: hidden;
  background-color: #fff;
  border-radius: 16rpx;
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 24rpx;
  font-size: 30rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.menu-item:last-child {
  border-bottom: none;
}

.arrow {
  color: #c0c4cc;
}
</style>
