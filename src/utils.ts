import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { Context } from 'cordis'

interface KeyStatus {
  lastResetDate: string
  exhaustedKeys: string[]
}

export class YoutubeKeyManager {
  private keys: string[] = []
  private exhaustedKeys: Set<string> = new Set()
  private lastResetDate: string = ''
  
  private readonly keysFilePath: string
  private readonly statusFilePath: string
  private isInitialized: boolean = false
  private ctx: Context

  constructor(ctx: Context, apiKeyFile: string) {
    this.ctx = ctx
    this.keysFilePath = path.resolve(process.cwd(), apiKeyFile)
    this.statusFilePath = path.join(process.cwd(), 'data', 'youtube_key_status.json')
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return

    const dir = path.dirname(this.keysFilePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    await this.loadKeysFromFile()
    await this.loadStatus()
    this.checkAndResetQuota()
    
    this.isInitialized = true
    this.ctx.emit('lfvs/log', 'lfvs-youtube-adapter', 'info', `YoutubeKeyManager初始化完成。加载了 ${this.keys.length} 个Key，其中 ${this.exhaustedKeys.size} 个已耗尽。`)
  }

  private async loadKeysFromFile(): Promise<void> {
    this.keys = []
    if (!fs.existsSync(this.keysFilePath)) {
      this.ctx.emit('lfvs/log', 'lfvs-youtube-adapter', 'warn', `未找到Key文件: ${this.keysFilePath}。将仅使用爬虫模式。`)
      return
    }

    const fileStream = fs.createReadStream(this.keysFilePath)
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    })

    for await (const line of rl) {
      const key = line.trim()
      if (key && key.length > 20 && !key.startsWith('#')) {
        this.keys.push(key)
      }
    }
  }

  private async loadStatus(): Promise<void> {
    if (!fs.existsSync(this.statusFilePath)) return

    try {
      const data = await fs.promises.readFile(this.statusFilePath, 'utf-8')
      const status: KeyStatus = JSON.parse(data)
      this.exhaustedKeys = new Set(status.exhaustedKeys)
      this.lastResetDate = status.lastResetDate
    } catch (error) {
      this.ctx.emit('lfvs/log', 'lfvs-youtube-adapter', 'error', '读取Key状态文件失败，将重置状态:', error)
      this.exhaustedKeys.clear()
      this.lastResetDate = ''
    }
  }

  private async saveStatus(): Promise<void> {
    const status: KeyStatus = {
      lastResetDate: this.lastResetDate,
      exhaustedKeys: Array.from(this.exhaustedKeys)
    }
    try {
      await fs.promises.writeFile(this.statusFilePath, JSON.stringify(status, null, 2), 'utf-8')
    } catch (error) {
      this.ctx.emit('lfvs/log', 'lfvs-youtube-adapter', 'error', '保存Key状态失败:', error)
    }
  }

  private getPacificDateStr(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
    }).format(new Date())
  }

  private checkAndResetQuota(): void {
    const currentPTDate = this.getPacificDateStr()

    if (currentPTDate !== this.lastResetDate) {
      if (this.exhaustedKeys.size > 0) {
        this.ctx.emit('lfvs/log', 'lfvs-youtube-adapter', 'info', `检测到日期变更 (PT: ${this.lastResetDate} -> ${currentPTDate})，重置所有Key状态。`)
        this.exhaustedKeys.clear()
      }
      this.lastResetDate = currentPTDate
      this.saveStatus()
    }
  }

  public async getRandomAvailableKey(): Promise<string | null> {
    if (!this.isInitialized) await this.init()
    
    this.checkAndResetQuota()

    const availableKeys = this.keys.filter(k => !this.exhaustedKeys.has(k))

    if (availableKeys.length === 0) {
      return null
    }

    const randomIndex = Math.floor(Math.random() * availableKeys.length)
    return availableKeys[randomIndex]
  }

  public async markKeyExhausted(key: string): Promise<void> {
    if (!this.keys.includes(key)) return

    this.ctx.emit('lfvs/log', 'lfvs-youtube-adapter', 'warn', `Key额度耗尽或失效: ${key.substring(0, 8)}...`)
    this.exhaustedKeys.add(key)
    await this.saveStatus()
  }
  
  public hasAvailableKeys(): boolean {
    return this.keys.some(k => !this.exhaustedKeys.has(k))
  }

  public getKeyStats(): { total: number; available: number; exhausted: number } {
    if (!this.isInitialized) {
      return { total: 0, available: 0, exhausted: 0 }
    }
    
    this.checkAndResetQuota()

    const total = this.keys.length
    const exhausted = this.exhaustedKeys.size
    const available = total - exhausted

    return { total, available, exhausted }
  }
}
