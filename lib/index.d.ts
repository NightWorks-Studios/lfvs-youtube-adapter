import { Context, Service } from 'cordis';
import z from 'schemastery';
import { GenericVideoInfo, GenericVideoStat, AdapterResult, LfvsAdapter } from 'lfvs-core';
export interface PlatformHealth {
    status: 'healthy' | 'down';
    latency: number;
    message: string;
    mode: string;
    availableKeys: number;
    totalKeys: number;
}
export interface Config {
    proxyUrl?: string;
    apiKeyFile: string;
}
export declare const Config: z<Config>;
export declare class YoutubeAdapterService extends Service implements LfvsAdapter {
    static inject: string[];
    platform: string;
    private keyManager;
    private lastHealthCache;
    private lastHealthTime;
    private config;
    private isOnline;
    private apiClient;
    constructor(ctx: Context, config: Config);
    protected start(): Promise<void>;
    private setOnline;
    getCredentials(): any;
    private handleApiError;
    getVideoInfoAndStats(videoId: string): Promise<AdapterResult<{
        info: GenericVideoInfo;
        stat: GenericVideoStat;
    }>>;
    getUploaderRecentVideos(uploaderId: string): Promise<AdapterResult<GenericVideoInfo[]>>;
    getUploaderInfo(uploaderId: string): Promise<AdapterResult<{
        uid: string;
        name: string;
        avatar?: string;
    }>>;
    private fetchByApi;
    private fetchRecentByApi;
    private isQuotaError;
    private parseNumberStr;
    private generateCommentToken;
    private fetchExactCommentCount;
    private fetchByScraping;
    private fetchRecentByScraping;
    private parseRelativeTime;
    getHealth(): Promise<PlatformHealth>;
}
export declare const apply: (ctx: Context, config: Config) => void;
declare module '@cordisjs/plugin-webui' {
    interface Events {
        'youtube/status'(): any;
    }
}
