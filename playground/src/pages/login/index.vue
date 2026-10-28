<script setup lang="ts">
import { redirectTo } from '@blyou/uni-router'
import { ref } from 'vue'
import { signIn } from '../../utils/auth'

definePage({
  style: { navigationBarTitleText: '登录' },
})

const account = ref('')
const password = ref('')

function submit() {
  if (!account.value.trim()) {
    uni.showToast({ title: '请输入账号', icon: 'none' })
    return
  }
  if (!password.value) {
    uni.showToast({ title: '请输入密码', icon: 'none' })
    return
  }
  signIn(account.value)
  uni.showToast({ title: '登录成功', icon: 'success', duration: 800 })
  setTimeout(() => {
    redirectTo({ url: '/pages/mine/profile' })
  }, 800)
}
</script>

<template>
  <view class="content">
    <text class="title">登录</text>
    <text class="desc">登录后可访问个人信息页</text>

    <view class="form">
      <input v-model="account" class="input" placeholder="请输入账号" />
      <input v-model="password" class="input" password placeholder="请输入密码" />
    </view>

    <button class="submit" @click="submit">登录</button>
  </view>
</template>

<style scoped>
.content {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  padding: 60rpx 40rpx;
}

.title {
  font-size: 44rpx;
  font-weight: 600;
  color: #2c3e50;
}

.desc {
  font-size: 26rpx;
  color: #909399;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-top: 20rpx;
}

.input {
  height: 88rpx;
  padding: 0 24rpx;
  font-size: 30rpx;
  background-color: #fff;
  border-radius: 16rpx;
}

.submit {
  margin-top: 20rpx;
  font-size: 32rpx;
}
</style>
