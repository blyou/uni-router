<script setup lang="ts">
import { redirectTo } from '@blyou/uni-router'
import { ref } from 'vue'
import { currentUser, signOut } from '../../utils/auth'

definePage({
  needLogin: true,
  style: { navigationBarTitleText: '个人信息' },
})

const user = ref(currentUser())

function logout() {
  signOut()
  redirectTo('/pages/login/index')
}
</script>

<template>
  <view class="content">
    <view class="profile">
      <image class="avatar" src="/static/logo.png" />
      <view class="info">
        <text class="nickname">{{ user.nickname }}</text>
        <text class="account">{{ user.account }}</text>
      </view>
    </view>

    <view class="card">
      <view class="row">
        <text class="label">昵称</text>
        <text>{{ user.nickname }}</text>
      </view>
      <view class="row">
        <text class="label">账号</text>
        <text>{{ user.account }}</text>
      </view>
      <view class="row">
        <text class="label">登录状态</text>
        <text class="status">已登录</text>
      </view>
      <view class="row">
        <text class="label">页面配置</text>
        <text>needLogin: true</text>
      </view>
    </view>

    <button class="logout" @click="logout">退出登录</button>
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

.account {
  font-size: 26rpx;
  color: #909399;
}

.card {
  overflow: hidden;
  background-color: #fff;
  border-radius: 16rpx;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 24rpx;
  font-size: 30rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.row:last-child {
  border-bottom: none;
}

.label {
  color: #606266;
}

.status {
  color: #4cd964;
}

.logout {
  font-size: 30rpx;
}
</style>
