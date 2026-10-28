export interface AuthUser {
  account: string
  nickname: string
}

const tokenKey = 'uni-router:token'
const userKey = 'uni-router:user'

export function isLoggedIn() {
  return Boolean(uni.getStorageSync(tokenKey))
}

export function currentUser(): AuthUser {
  const stored: unknown = uni.getStorageSync(userKey)
  if (stored && typeof stored === 'object' && 'account' in stored && 'nickname' in stored) {
    return stored as AuthUser
  }
  return { account: 'demo', nickname: 'uni-router 用户' }
}

export function signIn(account: string): AuthUser {
  const trimmed = account.trim()
  const user = { account: trimmed, nickname: trimmed || 'uni-router 用户' }
  uni.setStorageSync(tokenKey, 'demo-token')
  uni.setStorageSync(userKey, user)
  return user
}

export function signOut() {
  uni.removeStorageSync(tokenKey)
  uni.removeStorageSync(userKey)
}
