<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useContext, send } from '@cordisjs/client'

const ctx = useContext()

const isCurrentPlugin = computed(() => {
  const entry = ctx.manager?.currentEntry
  return entry?.name === 'lfvs-youtube-adapter' || entry?.name?.includes('lfvs-youtube-adapter')
})

interface PlatformHealth {
  status: 'healthy' | 'down'
  latency: number
  message: string
  mode: string
  availableKeys: number
  totalKeys: number
}

const health = ref<PlatformHealth | null>(null)
let timer: number | undefined

const fetchHealth = async () => {
  if (!isCurrentPlugin.value) return
  try {
    health.value = await send('youtube/status')
  } catch (e) {
    console.error('Failed to fetch youtube status', e)
  }
}

onMounted(() => {
  fetchHealth()
  timer = window.setInterval(fetchHealth, 10000)
})

onUnmounted(() => {
  if (timer !== undefined) clearInterval(timer)
})

const getStatusType = (status: string) => {
  if (status === 'healthy') return 'success'
  if (status === 'down') return 'danger'
  return 'warning'
}
</script>

<template>
  <k-slot-item v-if="isCurrentPlugin" :order="-100">
    <k-comment :type="health ? getStatusType(health.status) : 'warning'">
      <h3>YouTube 适配器状态</h3>
      <template v-if="health">
        <p><strong>当前状态:</strong> {{ health.status === 'healthy' ? '健康' : '异常' }} (延迟: {{ health.latency }}ms)</p>
        <p><strong>工作模式:</strong> {{ health.mode === 'api' ? 'API 模式' : '网页爬虫模式' }}</p>
        <p><strong>API 密钥:</strong> 可用 {{ health.availableKeys }} / 总计 {{ health.totalKeys }}</p>
        <p v-if="health.message"><strong>详细信息:</strong> {{ health.message }}</p>
      </template>
      <template v-else>
        <p>正在获取状态...</p>
      </template>
    </k-comment>
  </k-slot-item>
</template>

<style scoped>
h3 {
  margin-top: 0;
  margin-bottom: 8px;
}
p {
  margin: 4px 0;
}
</style>
