import { DropboxDownloadResult, DropboxFileMetadata } from '../dropbox/dropbox-types';
import DropboxClient from '../dropbox/dropbox-client';
import config from '../../config';
import dotenv from 'dotenv';

export class ExtendedClient {
    private textEncoder = new TextEncoder();
    private textDecoder = new TextDecoder();

    public defaultPath: string = config.dropboxDefaultPath;

    private fromDropboxClient: DropboxClient;
    private toDropboxClient: DropboxClient;

    constructor() {
        dotenv.config();

        this.fromDropboxClient = new DropboxClient({
            clientId: process.env.DBX_FROM_CLIENT_KEY,
            clientSecret: process.env.DBX_FROM_CLIENT_SECRET,
            refreshToken: process.env.DBX_FROM_REFRESH_TOKEN
        });

        this.toDropboxClient = new DropboxClient({
            clientId: process.env.DBX_TO_CLIENT_KEY,
            clientSecret: process.env.DBX_TO_CLIENT_SECRET,
            refreshToken: process.env.DBX_TO_REFRESH_TOKEN
        });
    }

    public async validateAccessTokens(): Promise<void> {
        console.log('Validating access tokens...');

        Promise.all([await this.fromDropboxClient.validateAccessToken(), await this.toDropboxClient.validateAccessToken()]).catch(() => {
            throw new Error('Access tokens are invalid');
        });
    }

    public async getAccessToken(type: string): Promise<string> {
        switch (type) {
            case 'from':
                return await this.fromDropboxClient.getAccessToken();
            case 'to':
                return await this.toDropboxClient.getAccessToken();
            default:
                throw new Error('Invalid type');
        }
    }

    public async setAccessToken(type: string, token: string): Promise<void> {
        switch (type) {
            case 'from':
                this.fromDropboxClient.setAccessToken(token);
                break;
            case 'to':
                this.toDropboxClient.setAccessToken(token);
                break;
            default:
                throw new Error('Invalid type');
        }
    }

    public getDefaultPath(): string {
        return this.defaultPath;
    }

    public cursor(cursor: string): string {
        return this.defaultPath + cursor;
    }

    public async download(path: string): Promise<DropboxDownloadResult> {
        return await this.fromDropboxClient.download(path);
    }

    public async upload(path: string, buffer: Buffer): Promise<DropboxFileMetadata> {
        return await this.toDropboxClient.upload(path, buffer);
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

    public divideArray<T>(array: T[], divider: number): T[][] {
        const chunks: T[][] = [];
        const chunkSize = Math.ceil(array.length / divider);

        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }
}
