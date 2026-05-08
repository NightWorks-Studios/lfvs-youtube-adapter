import { Context } from 'cordis';
export declare class YoutubeKeyManager {
    private keys;
    private exhaustedKeys;
    private lastResetDate;
    private readonly keysFilePath;
    private readonly statusFilePath;
    private isInitialized;
    private ctx;
    constructor(ctx: Context, apiKeyFile: string);
    init(): Promise<void>;
    private loadKeysFromFile;
    private loadStatus;
    private saveStatus;
    private getPacificDateStr;
    private checkAndResetQuota;
    getRandomAvailableKey(): Promise<string | null>;
    markKeyExhausted(key: string): Promise<void>;
    hasAvailableKeys(): boolean;
    getKeyStats(): {
        total: number;
        available: number;
        exhausted: number;
    };
}
