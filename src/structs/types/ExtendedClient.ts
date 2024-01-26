import { Dropbox } from "dropbox";
import { createReadStream } from 'fs';
import { DropboxFileResult } from "../../manager/interfaces";
import DiscordWebhookManager from "../../manager/discord/DiscordWebhookManager";
import config from '../../../config';
import dotenv from 'dotenv';
import axios from 'axios';
import FormData from 'form-data';

export class ExtendedClient extends Dropbox {
    private readonly discordWebhook: DiscordWebhookManager | undefined;
    private discordWebhookInitialized: boolean = false;

    private textEncoder = new TextEncoder();
    private textDecoder = new TextDecoder();

    public defaultPath: string = config.dropboxDefaultPath;

    constructor() {
        dotenv.config();

        super({
            clientId: process.env.DBX_CLIENT_KEY,
            clientSecret: process.env.DBX_CLIENT_SECRET,
            refreshToken: process.env.DBX_REFRESH_TOKEN
        });

        if (!this.discordWebhookInitialized) {
            this.discordWebhook = new DiscordWebhookManager();
            this.discordWebhookInitialized = true;
        }
    }

    public getDefaultPath(): string {
        return this.defaultPath;
    }

    public cursor(cursor: string): string {
        return this.defaultPath + cursor;
    }

    public async listContents(path: string | null | undefined = null, all: boolean = false) {
        const { result } = await this.filesListFolder({ path: path || this.defaultPath });

        if (all && result.has_more) {
            let hasMore: boolean = result.has_more;
            let cursor: string = result.cursor;

            while (hasMore) {
                const moreResult = await this.listContentsContinue(cursor);
                result.entries.push(...moreResult.entries);

                hasMore = moreResult.has_more;
                cursor = moreResult.cursor;
            }
        }
        return result.entries;
    }

    public async listContentsContinue(cursor: string) {
        return (await this.filesListFolderContinue({ cursor: cursor })).result
    }

    public async getFile(path: string): Promise<DropboxFileResult> {
        const { result } = (await this.filesDownload({ path: path })) as any

        return {
            name: result.name,
            size: result.size,
            buffer: result.fileBinary
        }
    }

    public async uploadDiscordFile(path: string, name: string, currentAttempt: number): Promise<{ status: string, result: string }> {
        if (!this.discordWebhookInitialized || !this.discordWebhook) {
            throw new Error('Discord Webhook not initialized');
        }

        const webHookUrl = await this.discordWebhook.getWebhook();
        const form = new FormData();

        form.append('content', '');
        form.append('file', createReadStream(path), {
            filename: name,
            contentType: 'text/plain',
        });

        try {
            const response = await axios.post(webHookUrl, form, {
                headers: {
                    ...form.getHeaders(),
                },
            });

            const responseData = response.data;

            if (responseData.attachments && responseData.attachments.length > 0) {
                return {
                    status: 'success',
                    result: this.discordUrlToProxyId(responseData.attachments[0].url)
                };
            } else {
                throw new Error('Error getting attachment URL from Discord response');
            }
        } catch (error: any) {
            if (error.response?.status === 429) {
                throw new Error(`Discord rate limit reached`);
            }

            if (axios.isAxiosError(error) && error.isAxiosError) {
                if (currentAttempt < 1) {
                    return {
                        status: 'retry',
                        result: 'Connection error uploading Discord file. Retrying...'
                    };
                } else {
                    throw new Error(`Maximum attempts reached. Unable to upload Discord file: ${error.message}`);
                }
            } else {
                throw new Error(`Non-retryable error uploading Discord file: ${error.message}`);
            }
        }
    }

    private discordUrlToProxyId(url: string): string {
        return url.replace(/https:\/\/cdn\.discordapp\.com\/attachments\/([^?]*).*/, (_, group: string): string => {
            return `ProxyId=${encodeURIComponent(group)}`;
        });
    }

    public async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public serialize(obj: {}): ArrayBuffer {
        const jsonString = JSON.stringify(obj);
        return this.textEncoder.encode(jsonString).buffer;
    }

    public deserialize(buffer: ArrayBuffer): any {
        const uint8Array = new Uint8Array(buffer);
        const jsonString = this.textDecoder.decode(uint8Array);
        return JSON.parse(jsonString);
    }

    public chunkArray<T>(array: T[], chunkSize: number): T[][] {
        const chunks: T[][] = [];

        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }
}