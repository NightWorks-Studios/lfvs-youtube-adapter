var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
import { Service } from "cordis";
import z from "schemastery";

// src/utils.ts
import fs from "fs";
import path from "path";
import readline from "readline";
var YoutubeKeyManager = class {
  static {
    __name(this, "YoutubeKeyManager");
  }
  keys = [];
  exhaustedKeys = /* @__PURE__ */ new Set();
  lastResetDate = "";
  keysFilePath;
  statusFilePath;
  isInitialized = false;
  ctx;
  constructor(ctx, apiKeyFile) {
    this.ctx = ctx;
    this.keysFilePath = path.resolve(process.cwd(), apiKeyFile);
    this.statusFilePath = path.join(process.cwd(), "data", "youtube_key_status.json");
  }
  async init() {
    if (this.isInitialized) return;
    const dir = path.dirname(this.keysFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await this.loadKeysFromFile();
    await this.loadStatus();
    this.checkAndResetQuota();
    this.isInitialized = true;
    this.ctx.emit("lfvs/log", "lfvs-youtube-adapter", "info", `YoutubeKeyManager初始化完成。加载了 ${this.keys.length} 个Key，其中 ${this.exhaustedKeys.size} 个已耗尽。`);
  }
  async loadKeysFromFile() {
    this.keys = [];
    if (!fs.existsSync(this.keysFilePath)) {
      this.ctx.emit("lfvs/log", "lfvs-youtube-adapter", "warn", `未找到Key文件: ${this.keysFilePath}。将仅使用爬虫模式。`);
      return;
    }
    const fileStream = fs.createReadStream(this.keysFilePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    for await (const line of rl) {
      const key = line.trim();
      if (key && key.length > 20 && !key.startsWith("#")) {
        this.keys.push(key);
      }
    }
  }
  async loadStatus() {
    if (!fs.existsSync(this.statusFilePath)) return;
    try {
      const data = await fs.promises.readFile(this.statusFilePath, "utf-8");
      const status = JSON.parse(data);
      this.exhaustedKeys = new Set(status.exhaustedKeys);
      this.lastResetDate = status.lastResetDate;
    } catch (error) {
      this.ctx.emit("lfvs/log", "lfvs-youtube-adapter", "error", "读取Key状态文件失败，将重置状态:", error);
      this.exhaustedKeys.clear();
      this.lastResetDate = "";
    }
  }
  async saveStatus() {
    const status = {
      lastResetDate: this.lastResetDate,
      exhaustedKeys: Array.from(this.exhaustedKeys)
    };
    try {
      await fs.promises.writeFile(this.statusFilePath, JSON.stringify(status, null, 2), "utf-8");
    } catch (error) {
      this.ctx.emit("lfvs/log", "lfvs-youtube-adapter", "error", "保存Key状态失败:", error);
    }
  }
  getPacificDateStr() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles"
    }).format(/* @__PURE__ */ new Date());
  }
  checkAndResetQuota() {
    const currentPTDate = this.getPacificDateStr();
    if (currentPTDate !== this.lastResetDate) {
      if (this.exhaustedKeys.size > 0) {
        this.ctx.emit("lfvs/log", "lfvs-youtube-adapter", "info", `检测到日期变更 (PT: ${this.lastResetDate} -> ${currentPTDate})，重置所有Key状态。`);
        this.exhaustedKeys.clear();
      }
      this.lastResetDate = currentPTDate;
      this.saveStatus();
    }
  }
  async getRandomAvailableKey() {
    if (!this.isInitialized) await this.init();
    this.checkAndResetQuota();
    const availableKeys = this.keys.filter((k) => !this.exhaustedKeys.has(k));
    if (availableKeys.length === 0) {
      return null;
    }
    const randomIndex = Math.floor(Math.random() * availableKeys.length);
    return availableKeys[randomIndex];
  }
  async markKeyExhausted(key) {
    if (!this.keys.includes(key)) return;
    this.ctx.emit("lfvs/log", "lfvs-youtube-adapter", "warn", `Key额度耗尽或失效: ${key.substring(0, 8)}...`);
    this.exhaustedKeys.add(key);
    await this.saveStatus();
  }
  getKeyCount() {
    return this.keys.length;
  }
  hasAvailableKeys() {
    return this.keys.some((k) => !this.exhaustedKeys.has(k));
  }
  getKeyStats() {
    if (!this.isInitialized) {
      return { total: 0, available: 0, exhausted: 0 };
    }
    this.checkAndResetQuota();
    const total = this.keys.length;
    const exhausted = this.exhaustedKeys.size;
    const available = total - exhausted;
    return { total, available, exhausted };
  }
};

// src/index.ts
var Config = z.object({
  apiKeyFile: z.string().default("data/valid_youtube_keys.txt").description("API Key 存放路径 (相对于应用的根目录)")
});
var YoutubeAdapterService = class extends Service {
  static {
    __name(this, "YoutubeAdapterService");
  }
  static inject = ["http", "lfvs.core", "logger"];
  platform = "youtube";
  keyManager;
  lastHealthCache = null;
  lastHealthTime = 0;
  config;
  isOnline = false;
  constructor(ctx, config) {
    super(ctx, "lfvs.youtube");
    this.config = config;
    this.keyManager = new YoutubeKeyManager(ctx, config.apiKeyFile);
    ctx.inject(["webui"], (ctx2) => {
      ctx2.webui.addEntry({
        modulePath: "lfvs-youtube-adapter",
        baseUrl: import.meta.url,
        source: "../client/index.ts",
        manifest: "../dist/manifest.json"
      }, {
        "youtube/status": /* @__PURE__ */ __name(() => this.getHealth(), "youtube/status")
      });
    });
    Promise.resolve().then(() => {
      this.start().catch((e) => {
        this.ctx.emit("lfvs/adapter-offline", this.platform, e.message || "启动失败");
      });
    });
  }
  async start() {
    await this.keyManager.init();
    this.setOnline();
  }
  setOnline() {
    this.isOnline = true;
    this.ctx.get("lfvs.core").registerAdapter(this);
    this.ctx.emit("lfvs/adapter-online", this.platform);
  }
  getCredentials() {
    return null;
  }
  stop() {
    if (this.isOnline) {
      this.isOnline = false;
      this.ctx.get("lfvs.core").unregisterAdapter(this.platform);
      this.ctx.emit("lfvs/adapter-offline", this.platform, "插件卸载");
    }
  }
  handleApiError(e, action, target, startTime) {
    const costMs = Date.now() - startTime;
    this.ctx.emit("lfvs/api-request", this.platform, action, target, false, costMs, e.message);
    return { status: "error", message: e.message, retryable: true };
  }
  /**
   * 判断 ctx.http 抛出的异常是否包含特定 HTTP 状态码。
   * Cordis HTTP 抛出的错误对象通常将 status 放在 e.response?.status 或 e.response?.statusCode 上。
   */
  getHttpStatus(e) {
    return e.response?.status ?? e.response?.statusCode;
  }
  async getVideoInfoAndStats(videoId) {
    const start = Date.now();
    const keyCount = this.keyManager.getKeyCount();
    for (let attempt = 0; attempt <= keyCount; attempt++) {
      const apiKey = await this.keyManager.getRandomAvailableKey();
      if (!apiKey) break;
      try {
        const result = await this.fetchByApi(videoId, apiKey);
        const costMs = Date.now() - start;
        if (result) {
          this.ctx.emit("lfvs/api-request", this.platform, "getVideoInfoAndStats(api)", videoId, true, costMs);
          return { status: "success", data: result };
        } else {
          this.ctx.emit("lfvs/api-request", this.platform, "getVideoInfoAndStats(api)", videoId, false, costMs, "404 Not Found");
          return { status: "not_found", message: "视频不存在" };
        }
      } catch (error) {
        const status = this.getHttpStatus(error);
        if (status === 403 && this.isQuotaError(error.response?.data ?? error.data)) {
          await this.keyManager.markKeyExhausted(apiKey);
          continue;
        }
        if (status === 404) {
          this.ctx.emit("lfvs/api-request", this.platform, "getVideoInfoAndStats(api)", videoId, false, Date.now() - start, "404 Not Found");
          return { status: "not_found", message: "视频不存在" };
        }
        this.ctx.emit("lfvs/api-request", this.platform, "getVideoInfoAndStats(api)", videoId, false, Date.now() - start, error.message);
        break;
      }
    }
    try {
      const result = await this.fetchByScraping(videoId);
      const costMs = Date.now() - start;
      if (result) {
        this.ctx.emit("lfvs/api-request", this.platform, "getVideoInfoAndStats(scrape)", videoId, true, costMs);
        return { status: "success", data: result };
      } else {
        this.ctx.emit("lfvs/api-request", this.platform, "getVideoInfoAndStats(scrape)", videoId, false, costMs, "Scraping returned null");
        return { status: "error", message: "爬虫未获取到数据", retryable: true };
      }
    } catch (e) {
      return this.handleApiError(e, "getVideoInfoAndStats(scrape)", videoId, start);
    }
  }
  async getUploaderRecentVideos(uploaderId) {
    const start = Date.now();
    const keyCount = this.keyManager.getKeyCount();
    for (let attempt = 0; attempt <= keyCount; attempt++) {
      const apiKey = await this.keyManager.getRandomAvailableKey();
      if (!apiKey) break;
      try {
        const result = await this.fetchRecentByApi(uploaderId, apiKey);
        const costMs = Date.now() - start;
        this.ctx.emit("lfvs/api-request", this.platform, "getUploaderRecentVideos(api)", uploaderId, true, costMs);
        return { status: "success", data: result };
      } catch (error) {
        const status = this.getHttpStatus(error);
        if (status === 403 && this.isQuotaError(error.response?.data ?? error.data)) {
          await this.keyManager.markKeyExhausted(apiKey);
          continue;
        }
        if (status === 404) {
          this.ctx.emit("lfvs/api-request", this.platform, "getUploaderRecentVideos(api)", uploaderId, false, Date.now() - start, "404 Not Found");
          return { status: "not_found", message: "频道不存在" };
        }
        this.ctx.emit("lfvs/api-request", this.platform, "getUploaderRecentVideos(api)", uploaderId, false, Date.now() - start, error.message);
        break;
      }
    }
    try {
      const result = await this.fetchRecentByScraping(uploaderId);
      const costMs = Date.now() - start;
      if (result.length > 0) {
        this.ctx.emit("lfvs/api-request", this.platform, "getUploaderRecentVideos(scrape)", uploaderId, true, costMs);
        return { status: "success", data: result };
      } else {
        this.ctx.emit("lfvs/api-request", this.platform, "getUploaderRecentVideos(scrape)", uploaderId, false, costMs, "Empty list or failed");
        return { status: "error", message: "频道近期视频为空或获取失败", retryable: true };
      }
    } catch (e) {
      return this.handleApiError(e, "getUploaderRecentVideos(scrape)", uploaderId, start);
    }
  }
  async getUploaderInfo(uploaderId) {
    const start = Date.now();
    const keyCount = this.keyManager.getKeyCount();
    for (let attempt = 0; attempt <= keyCount; attempt++) {
      const apiKey = await this.keyManager.getRandomAvailableKey();
      if (!apiKey) break;
      try {
        const channelUrl = "https://www.googleapis.com/youtube/v3/channels";
        const channelRes = await this.ctx.http.get(channelUrl, {
          params: { part: "snippet", id: uploaderId, key: apiKey },
          headers: this.getYoutubeHeaders()
        });
        const items = channelRes?.items;
        if (items && items.length > 0) {
          const item = items[0];
          this.ctx.emit("lfvs/api-request", this.platform, "getUploaderInfo(api)", uploaderId, true, Date.now() - start);
          return {
            status: "success",
            data: {
              uid: uploaderId,
              name: item.snippet.title,
              avatar: item.snippet.thumbnails?.default?.url
            }
          };
        }
        this.ctx.emit("lfvs/api-request", this.platform, "getUploaderInfo(api)", uploaderId, false, Date.now() - start, "404 Not Found");
        return { status: "not_found", message: "频道不存在" };
      } catch (error) {
        const status = this.getHttpStatus(error);
        if (status === 403 && this.isQuotaError(error.response?.data ?? error.data)) {
          await this.keyManager.markKeyExhausted(apiKey);
          continue;
        }
        if (status === 404) {
          this.ctx.emit("lfvs/api-request", this.platform, "getUploaderInfo(api)", uploaderId, false, Date.now() - start, "404 Not Found");
          return { status: "not_found", message: "频道不存在" };
        }
        this.ctx.emit("lfvs/api-request", this.platform, "getUploaderInfo(api)", uploaderId, false, Date.now() - start, error.message);
        break;
      }
    }
    try {
      const url = `https://www.youtube.com/channel/${uploaderId}`;
      const html = await this.ctx.http.get(url, {
        headers: this.getYoutubeHeaders(),
        responseType: "text"
      });
      const dataMatch = html.match(/ytInitialData\s*=\s*({.+?});/);
      if (dataMatch && dataMatch[1]) {
        const data = JSON.parse(dataMatch[1]);
        const headerTitle = data.header?.c4TabbedHeaderRenderer?.title || data.metadata?.channelMetadataRenderer?.title;
        const avatar = data.metadata?.channelMetadataRenderer?.avatar?.thumbnails?.[0]?.url;
        if (headerTitle) {
          this.ctx.emit("lfvs/api-request", this.platform, "getUploaderInfo(scrape)", uploaderId, true, Date.now() - start);
          return { status: "success", data: { uid: uploaderId, name: headerTitle, avatar } };
        }
      }
      this.ctx.emit("lfvs/api-request", this.platform, "getUploaderInfo(scrape)", uploaderId, false, Date.now() - start, "Parse failed");
      return { status: "error", message: "无法解析频道信息", retryable: true };
    } catch (e) {
      const status = this.getHttpStatus(e);
      if (status === 404) {
        this.ctx.emit("lfvs/api-request", this.platform, "getUploaderInfo(scrape)", uploaderId, false, Date.now() - start, "404 Not Found");
        return { status: "not_found", message: "频道不存在" };
      }
      return this.handleApiError(e, "getUploaderInfo(scrape)", uploaderId, start);
    }
  }
  getYoutubeHeaders() {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Referer": "https://www.youtube.com/",
      "Origin": "https://www.youtube.com"
    };
  }
  async fetchByApi(videoId, apiKey) {
    const url = "https://www.googleapis.com/youtube/v3/videos";
    const response = await this.ctx.http.get(url, {
      params: { part: "snippet,statistics", id: videoId, key: apiKey },
      headers: this.getYoutubeHeaders()
    });
    const items = response?.items;
    if (!items || items.length === 0) return null;
    const item = items[0];
    const snippet = item.snippet;
    const statistics = item.statistics;
    const thumbnails = snippet.thumbnails;
    const bestPic = thumbnails.maxres?.url || thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || "";
    return {
      info: {
        platform: "youtube",
        videoId: item.id,
        title: snippet.title,
        pic: bestPic,
        pubdate: new Date(snippet.publishedAt),
        uploader: { uid: snippet.channelId, name: snippet.channelTitle }
      },
      stat: {
        view: parseInt(statistics.viewCount || "0"),
        like: parseInt(statistics.likeCount || "0"),
        reply: parseInt(statistics.commentCount || "0"),
        danmaku: null,
        favorite: parseInt(statistics.favoriteCount || "0"),
        coin: null,
        share: null
      }
    };
  }
  async fetchRecentByApi(channelId, apiKey) {
    const channelUrl = "https://www.googleapis.com/youtube/v3/channels";
    const channelRes = await this.ctx.http.get(channelUrl, {
      params: { part: "contentDetails,snippet", id: channelId, key: apiKey },
      headers: this.getYoutubeHeaders()
    });
    const channelItems = channelRes?.items;
    if (!channelItems || channelItems.length === 0) return [];
    const uploadsPlaylistId = channelItems[0].contentDetails.relatedPlaylists.uploads;
    const channelName = channelItems[0].snippet.title;
    const playlistUrl = "https://www.googleapis.com/youtube/v3/playlistItems";
    const playlistRes = await this.ctx.http.get(playlistUrl, {
      params: { part: "snippet", playlistId: uploadsPlaylistId, maxResults: 20, key: apiKey },
      headers: this.getYoutubeHeaders()
    });
    const items = playlistRes?.items || [];
    const videos = [];
    for (const item of items) {
      const snippet = item.snippet;
      const resourceId = snippet.resourceId;
      if (resourceId.kind === "youtube#video") {
        const thumbnails = snippet.thumbnails;
        const bestPic = thumbnails.maxres?.url || thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || "";
        videos.push({
          platform: "youtube",
          videoId: resourceId.videoId,
          title: snippet.title,
          pic: bestPic,
          pubdate: new Date(snippet.publishedAt),
          uploader: { uid: channelId, name: channelName }
        });
      }
    }
    return videos;
  }
  isQuotaError(errorData) {
    if (!errorData?.error?.errors) return false;
    return errorData.error.errors.some((e) => e.reason === "quotaExceeded");
  }
  parseNumberStr(str) {
    if (!str) return 0;
    let cleanStr = str.replace(/,/g, "");
    let multiplier = 1;
    if (cleanStr.includes("万")) {
      multiplier = 1e4;
      cleanStr = cleanStr.replace("万", "");
    } else if (cleanStr.includes("亿")) {
      multiplier = 1e8;
      cleanStr = cleanStr.replace("亿", "");
    } else if (cleanStr.toUpperCase().includes("K")) {
      multiplier = 1e3;
      cleanStr = cleanStr.replace(/k/i, "");
    } else if (cleanStr.toUpperCase().includes("M")) {
      multiplier = 1e6;
      cleanStr = cleanStr.replace(/m/i, "");
    }
    const match = cleanStr.match(/(\d+(\.\d+)?)/);
    if (match) {
      return Math.floor(parseFloat(match[1]) * multiplier);
    }
    return 0;
  }
  generateCommentToken(videoId) {
    const videoIdBuffer = Buffer.from(videoId);
    const targetBuffer = Buffer.from("comments-section");
    const buffer = Buffer.concat([
      Buffer.from([18, 13]),
      Buffer.from([18, videoIdBuffer.length]),
      videoIdBuffer,
      Buffer.from([24, 6]),
      Buffer.from([50, 37]),
      Buffer.from([34, 17]),
      Buffer.from([18, videoIdBuffer.length]),
      videoIdBuffer,
      Buffer.from([48, 0, 120, 2, 66, targetBuffer.length]),
      targetBuffer
    ]);
    return encodeURIComponent(buffer.toString("base64"));
  }
  async fetchExactCommentCount(videoId) {
    try {
      const token = this.generateCommentToken(videoId);
      const apiUrl = "https://www.youtube.com/youtubei/v1/next";
      const payload = {
        context: {
          client: { clientName: "WEB", clientVersion: "2.20241219.01.01", hl: "zh-CN", timeZone: "Asia/Shanghai" }
        },
        continuation: token
      };
      const data = await this.ctx.http.post(apiUrl, payload, { headers: this.getYoutubeHeaders() });
      const endpoints = data?.onResponseReceivedEndpoints || [];
      for (const endpoint of endpoints) {
        const reloadCommand = endpoint.reloadContinuationItemsCommand;
        if (reloadCommand?.slot === "RELOAD_CONTINUATION_SLOT_HEADER") {
          const items = reloadCommand.continuationItems || [];
          for (const item of items) {
            const headerRenderer = item.commentsHeaderRenderer;
            if (headerRenderer?.countText) {
              const countStr = headerRenderer.countText.runs?.[0]?.text || headerRenderer.countText.simpleText;
              if (countStr) {
                return this.parseNumberStr(countStr);
              }
            }
          }
        }
      }
      return null;
    } catch (error) {
      this.ctx.emit(
        "lfvs/log",
        "youtube-adapter",
        "debug",
        `fetchExactCommentCount 失败 [${videoId}]: ${error.message}`
      );
      return null;
    }
  }
  async fetchByScraping(videoId) {
    try {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const [htmlRaw, exactCommentCount] = await Promise.all([
        this.ctx.http.get(url, { headers: this.getYoutubeHeaders(), responseType: "text" }),
        this.fetchExactCommentCount(videoId)
      ]);
      const html = htmlRaw;
      const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
      const dataMatch = html.match(/ytInitialData\s*=\s*({.+?});/);
      if (!playerMatch || !playerMatch[1]) return null;
      const playerResponse = JSON.parse(playerMatch[1]);
      const videoDetails = playerResponse.videoDetails;
      if (!videoDetails) return null;
      const microformat = playerResponse.microformat?.playerMicroformatRenderer;
      let viewCount = parseInt(videoDetails.viewCount || "0");
      let likeCount = 0;
      let commentCount = exactCommentCount !== null ? exactCommentCount : 0;
      if (dataMatch && dataMatch[1]) {
        const initialData = JSON.parse(dataMatch[1]);
        const contents = initialData.contents?.twoColumnWatchNextResults?.results?.results?.contents;
        if (Array.isArray(contents)) {
          const primaryInfo = contents.find((c) => c.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
          if (primaryInfo) {
            const buttons = primaryInfo.videoActions?.menuRenderer?.topLevelButtons || [];
            for (const btn of buttons) {
              const viewModel = btn.segmentedLikeDislikeButtonViewModel?.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel;
              if (viewModel) {
                const label = viewModel.accessibilityText || viewModel.title;
                if (label) likeCount = this.parseNumberStr(label);
                break;
              }
            }
          }
        }
        if (exactCommentCount === null) {
          const panels = initialData.engagementPanels;
          if (Array.isArray(panels)) {
            const commentPanel = panels.find((p) => p.engagementPanelSectionListRenderer?.panelIdentifier === "engagement-panel-comments-section");
            if (commentPanel) {
              const header = commentPanel.engagementPanelSectionListRenderer?.header?.engagementPanelTitleHeaderRenderer;
              const contextInfo = header?.contextualInfo?.runs?.[0]?.text;
              if (contextInfo) commentCount = this.parseNumberStr(contextInfo);
            }
          }
        }
      }
      return {
        info: {
          platform: "youtube",
          videoId: videoDetails.videoId,
          title: videoDetails.title,
          pic: videoDetails.thumbnail.thumbnails.sort((a, b) => b.width - a.width)[0]?.url || "",
          pubdate: new Date(microformat?.publishDate || (/* @__PURE__ */ new Date()).toISOString()),
          uploader: { uid: videoDetails.channelId, name: videoDetails.author }
        },
        stat: {
          view: viewCount,
          like: likeCount,
          reply: commentCount,
          danmaku: null,
          favorite: 0,
          coin: null,
          share: null
        }
      };
    } catch (error) {
      this.ctx.emit(
        "lfvs/log",
        "youtube-adapter",
        "warn",
        `fetchByScraping 失败 [${videoId}]: ${error.message}`
      );
      return null;
    }
  }
  async fetchRecentByScraping(uploaderId) {
    try {
      const url = `https://www.youtube.com/channel/${uploaderId}/videos`;
      const htmlRaw = await this.ctx.http.get(url, { headers: this.getYoutubeHeaders(), responseType: "text" });
      const html = htmlRaw;
      const dataMatch = html.match(/ytInitialData\s*=\s*({.+?});/);
      if (!dataMatch || !dataMatch[1]) return [];
      const data = JSON.parse(dataMatch[1]);
      const videos = [];
      const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs;
      if (!tabs) return [];
      const videoTab = tabs.find((t) => t.tabRenderer?.content?.richGridRenderer);
      if (!videoTab) return [];
      const items = videoTab.tabRenderer.content.richGridRenderer.contents;
      for (const item of items) {
        if (item.richItemRenderer?.content?.videoRenderer) {
          const v = item.richItemRenderer.content.videoRenderer;
          videos.push({
            platform: "youtube",
            videoId: v.videoId,
            title: v.title?.runs?.[0]?.text || "",
            pic: v.thumbnail?.thumbnails?.[0]?.url || "",
            pubdate: this.parseRelativeTime(v.publishedTimeText?.simpleText || ""),
            uploader: { uid: uploaderId, name: "" }
          });
        }
      }
      const headerTitle = data.header?.c4TabbedHeaderRenderer?.title || data.metadata?.channelMetadataRenderer?.title;
      if (headerTitle && videos.length > 0) {
        videos.forEach((v) => v.uploader.name = headerTitle);
      }
      return videos;
    } catch (error) {
      this.ctx.emit(
        "lfvs/log",
        "youtube-adapter",
        "warn",
        `fetchRecentByScraping 失败 [${uploaderId}]: ${error.message}`
      );
      return [];
    }
  }
  parseRelativeTime(text) {
    const now = /* @__PURE__ */ new Date();
    if (!text) return now;
    const numMatch = text.match(/\d+/);
    const num = numMatch ? parseInt(numMatch[0]) : 0;
    if (text.includes("分") || text.includes("minute")) now.setMinutes(now.getMinutes() - num);
    else if (text.includes("时") || text.includes("hour")) now.setHours(now.getHours() - num);
    else if (text.includes("天") || text.includes("day")) now.setDate(now.getDate() - num);
    else if (text.includes("周") || text.includes("week")) now.setDate(now.getDate() - num * 7);
    else if (text.includes("月") || text.includes("month")) now.setMonth(now.getMonth() - num);
    else if (text.includes("年") || text.includes("year")) now.setFullYear(now.getFullYear() - num);
    return now;
  }
  async getHealth() {
    const now = Date.now();
    if (this.lastHealthCache && now - this.lastHealthTime < 6e4) return this.lastHealthCache;
    const start = now;
    const keyStats = this.keyManager.getKeyStats();
    const hasKeys = this.keyManager.hasAvailableKeys();
    const mode = hasKeys ? "api" : "scraping";
    try {
      await this.ctx.http.head("https://www.youtube.com", { headers: this.getYoutubeHeaders() });
      const load = keyStats.total > 0 ? 1 - keyStats.available / keyStats.total : 0;
      const result = {
        status: "healthy",
        latency: Date.now() - start,
        message: hasKeys ? `API模式 (${keyStats.available}/${keyStats.total} Keys 可用)` : "爬虫模式 (回退)",
        mode,
        availableKeys: keyStats.available,
        totalKeys: keyStats.total,
        load
      };
      this.lastHealthCache = result;
      this.lastHealthTime = now;
      return result;
    } catch (error) {
      let msg = error.message;
      if (error.code === "ECONNABORTED") msg = "代理连接超时";
      if (error.code === "ECONNREFUSED") msg = "代理拒绝连接";
      const load = keyStats.total > 0 ? 1 - keyStats.available / keyStats.total : 1;
      const result = {
        status: "down",
        latency: Date.now() - start,
        message: msg,
        mode,
        availableKeys: keyStats.available,
        totalKeys: keyStats.total,
        load
      };
      this.lastHealthCache = result;
      this.lastHealthTime = now;
      return result;
    }
  }
};
var inject = ["http"];
var apply = /* @__PURE__ */ __name((ctx, config) => {
  ctx.plugin(YoutubeAdapterService, config);
}, "apply");
export {
  Config,
  YoutubeAdapterService,
  apply,
  inject
};
