import dotenv from 'dotenv';
import axios from 'axios';
import fetch from 'node-fetch';
import readline from 'readline';
import { ReadStream, createReadStream } from 'fs';
import {
    DefaultFileHeaderOptions,
    DefaultHeaderOptions,
    DropboxSharedLinkResultError,
    DropboxDomains,
    DropboxDownloadResult,
    DropboxFileMetadata,
    DropboxGetSharedLinkResult,
    DropboxOptions,
    DropboxSharedLinkResult,
    DropboxUploadResult,
    GenerateRefreshTokenResult,
    HeaderArgs,
    RefreshTokenResult,
    RequestOptions,
    RequestResponse
} from './dropbox-types';

export default class DropboxClient {
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly refreshToken: string;

    private accessToken: string | null = null;
    private accessTokenExpiration: number | null = null;

    /** fetchType - 'fetch-node' | 'axios' */
    private fetchType: string = 'fetch-node';

    /** Default AccessTokenExpirationBuffer - (3 hours) 10800000 milliseconds */
    private accessTokenExpirationBuffer: number = 1000 * 60 * 60 * 3;

    /**
     * @default
     *
     * [env] DBX_CLIENT_KEY
     * [env] DBX_CLIENT_SECRET
     * [env] DBX_REFRESH_TOKEN
     */
    constructor(options: DropboxOptions = {}) {
        dotenv.config();

        this.clientId = String(options.clientId ?? process.env.DBX_CLIENT_KEY);
        this.clientSecret = String(options.clientSecret ?? process.env.DBX_CLIENT_SECRET);
        this.refreshToken = String(options.refreshToken ?? process.env.DBX_REFRESH_TOKEN);

        if (options.fetchType) {
            if (options.fetchType !== 'fetch-node' && options.fetchType !== 'axios') {
                throw new Error('Invalid fetch type, use "fetch-node" or "axios"');
            }

            this.fetchType = options.fetchType;
        }
    }

    private fetchTypeNode(): boolean {
        return this.fetchType === 'fetch-node';
    }

    private canRefreshToken(): boolean {
        if (!this.accessTokenExpiration || !this.accessToken) {
            return true;
        }

        return Date.now() >= this.accessTokenExpiration - this.accessTokenExpirationBuffer;
    }

    private validateClient(): void {
        if (!this.clientId) {
            throw new Error('Missing client id');
        }

        if (!this.clientSecret) {
            throw new Error('Missing client secret');
        }
    }

    private buildRequestData(options: any) {
        const data = new URLSearchParams();

        for (const [key, value] of Object.entries(options)) {
            data.append(String(key), String(value));
        }

        return data;
    }

    private getSafeUnicode(char: string): string {
        const unicode = `000${char.charCodeAt(0).toString(16)}`.slice(-4);
        return `\\u${unicode}`;
    }

    private JSONHeader(args: any): string {
        return JSON.stringify(args).replace(/[\u007f-\uffff]/g, this.getSafeUnicode);
    }

    private getHeaderOptions(headers: HeaderArgs = {}, bearer: boolean = true): DefaultHeaderOptions {
        return {
            Authorization: bearer ? `Bearer ${this.accessToken}` : `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
            ...headers
        };
    }

    private getFileHeaderOptions(path: string, headers: HeaderArgs = {}): DefaultFileHeaderOptions {
        return this.getHeaderOptions({
            'Dropbox-API-Arg': this.JSONHeader({ path }),
            'Content-Type': 'application/octet-stream',
            ...headers
        }) as DefaultFileHeaderOptions;
    }

    public setAccessToken(token: string): void {
        this.accessToken = token;
        this.accessTokenExpirationBuffer = 1000 * 60 * 60 * 5;
    }

    public async getAccessToken(): Promise<string> {
        await this.validateAccessToken();

        return this.accessToken as string;
    }

    private async executeRequest(url: string, options: RequestOptions, asBuffer: boolean = false): Promise<RequestResponse> {
        let responseData: RequestResponse | null = null;

        if (this.fetchTypeNode()) {
            const response = await fetch(url, options);

            responseData = {
                ok: response.ok,
                status: response.status,
                headers: response.headers.raw(),
                data: asBuffer ? await response.arrayBuffer() : await response.json()
            };
        } else {
            const { body, ...restOptions } = options;

            let response: any = null;

            try {
                response = await axios(url, { ...restOptions, data: body });
            } catch (error: any) {
                response = error.response || error;
            }

            responseData = {
                ok: response.status === 200,
                status: response.status,
                headers: response.headers,
                data: response.data
            };
        }

        if (responseData === null) {
            throw new Error('Failed to execute request');
        }

        return responseData;
    }

    public async validateAccessToken(): Promise<void> {
        if (this.canRefreshToken()) {
            await this.refreshAccessToken();
        }

        return Promise.resolve();
    }

    private async askAuthorizationCode(authCodeURL: string) {
        return new Promise<string>((resolve) => {
            console.log('Open this URL in your browser:', authCodeURL);

            const readLine = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            const askQuestion = () => {
                readLine.question('Enter the authorization code: ', async (code) => {
                    if (!code) {
                        console.log('Authorization code is required');
                        return askQuestion();
                    }

                    readLine.close();
                    resolve(code);
                });
            };

            askQuestion();
        });
    }

    public async genereteRefreshToken() {
        this.validateClient();

        let authCodeURL = DropboxDomains.auth.authorizeCode;
        let authRefreshTokenURL = DropboxDomains.auth.refreshToken;

        authCodeURL += `?client_id=${this.clientId}&token_access_type=offline&response_type=code`;

        this.askAuthorizationCode(authCodeURL).then(async (authCode) => {
            authRefreshTokenURL += `?grant_type=authorization_code&code=${authCode}`;

            const response = await this.executeRequest(authRefreshTokenURL, {
                method: 'POST',
                headers: this.getHeaderOptions({}, false),
                body: this.buildRequestData({
                    grant_type: 'authorization_code',
                    code: authCode
                })
            });

            if (!response.ok) {
                throw new Error('Failed to generate refresh token');
            }

            const responseData: GenerateRefreshTokenResult = response.data;

            console.log('Refresh token:', responseData.refresh_token);
        });
    }

    private async refreshAccessToken(): Promise<void> {
        this.validateClient();

        const response = await this.executeRequest(DropboxDomains.auth.refreshToken, {
            method: 'POST',
            headers: this.getHeaderOptions({}, false),
            body: this.buildRequestData({
                grant_type: 'refresh_token',
                refresh_token: this.refreshToken
            })
        });

        if (!response.ok) {
            throw new Error('Failed to refresh access token');
        }

        const { access_token, expires_in } = response.data as RefreshTokenResult;

        if (access_token && expires_in) {
            if (expires_in < 60 * 60) {
                throw new Error('Invalid expiration time');
            }

            this.accessToken = access_token;
            this.accessTokenExpiration = Date.now() + expires_in * 1000;
            this.accessTokenExpirationBuffer = expires_in * 1000;
        } else {
            throw new Error('Failed to refresh access token');
        }

        return Promise.resolve();
    }

    public async download(path: string, asBlob: boolean = false): Promise<DropboxDownloadResult> {
        await this.validateAccessToken();

        const response = await this.executeRequest(
            `${DropboxDomains.files.content}/download`,
            {
                method: 'POST',
                headers: this.getFileHeaderOptions(path),
                responseType: 'arraybuffer'
            },
            true
        );

        if (!response.ok) {
            throw new Error('Failed to download file');
        }

        const file = asBlob ? new Blob([response.data], { type: response.headers['content-type'] }) : Buffer.from(response.data);
        const fileResponse = asBlob ? { fileBlob: file } : { fileBuffer: file };
        const dropboxApiResponse = JSON.parse(response.headers['dropbox-api-result']);

        return { ...dropboxApiResponse, ...fileResponse };
    }
    public async listFolderContents(path: string): Promise<DropboxFileMetadata[]> {
        await this.validateAccessToken();

        const response = await this.executeRequest(`${DropboxDomains.files.file}/list_folder`, {
            method: 'POST',
            headers: this.getHeaderOptions({ 'Content-Type': 'application/json' }),
            body: this.JSONHeader({ path })
        });

        if (!response.ok) {
            throw new Error('Failed to list folder contents');
        }

        return response.data.entries as DropboxFileMetadata[];
    }

    public async upload(
        path: string,
        file: Buffer | ReadStream | string,
        createBuffer: boolean = false,
        retryCount: number = 0,
        maxRetry: number = 3
    ): Promise<DropboxUploadResult> {
        await this.validateAccessToken();

        let responseData: DropboxUploadResult | null = null;

        try {
            const response = await this.executeRequest(`${DropboxDomains.files.content}/upload`, {
                method: 'POST',
                headers: this.getFileHeaderOptions(path, {
                    autorename: false,
                    mode: 'overwrite',
                    mute: true
                }),
                body: typeof file === 'string' ? (createBuffer ? Buffer.from(file) : createReadStream(file)) : file
            });

            if (!response.ok) {
                console.log('Response:', response);
                console.log('Response Data:', JSON.stringify(response.data, null, 2));
                throw new Error(`Failed to upload file`);
            }

            responseData = response.data;
        } catch (error: any) {
            if (retryCount++ <= maxRetry) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                return this.upload(path, file, createBuffer, retryCount);
            }

            console.log('Error:', error);
            throw new Error(error.message);
        }

        if (responseData === null) {
            throw new Error('Failed to upload file, no response data');
        }

        return responseData as DropboxUploadResult;
    }

    public async createSharedLink(path: string, settings: any = {}): Promise<DropboxSharedLinkResult> {
        await this.validateAccessToken();

        const response = await this.executeRequest(`${DropboxDomains.sharing.sharedLink}/create_shared_link_with_settings`, {
            method: 'POST',
            headers: this.getHeaderOptions({ 'Content-Type': 'application/json' }),
            body: this.JSONHeader({
                path,
                settings: {
                    requested_visibility: { '.tag': 'public' },
                    ...settings
                }
            })
        });

        if (!response.ok) {
            const { error_summary, error } = response.data as DropboxSharedLinkResultError;

            if (error_summary === 'shared_link_already_exists' || error?.['.tag'] === 'shared_link_already_exists') {
                throw new Error('Shared link already exists');
            }

            console.log(response.data);

            throw new Error('Failed to create shared link');
        }

        return response.data as DropboxSharedLinkResult;
    }

    public async revokeSharedLink(url: string): Promise<string> {
        await this.validateAccessToken();

        const response = await this.executeRequest(`${DropboxDomains.sharing.sharedLink}/revoke_shared_link`, {
            method: 'POST',
            headers: this.getHeaderOptions({ 'Content-Type': 'application/json' }),
            body: this.JSONHeader({ url })
        });

        if (!response.ok) {
            const { error_summary, error } = response.data as DropboxSharedLinkResultError;

            if (error_summary === 'shared_link_not_found/.' || error?.['.tag'] === 'shared_link_not_found') {
                throw new Error('Shared link not found');
            }

            throw new Error('Failed to revoke shared link');
        }

        return Promise.resolve('Shared link revoked');
    }

    public async getSharedLink(path: string): Promise<DropboxGetSharedLinkResult> {
        await this.validateAccessToken();

        const response = await this.executeRequest(`${DropboxDomains.sharing.sharedLink}/list_shared_links`, {
            method: 'POST',
            headers: this.getHeaderOptions({ 'Content-Type': 'application/json' }),
            body: this.JSONHeader({ path })
        });

        if (!response.ok) {
            throw new Error('Failed to get file metadata');
        }

        return response.data as DropboxGetSharedLinkResult;
    }

    public async getFileMetadata(path: string): Promise<DropboxFileMetadata> {
        await this.validateAccessToken();

        const response = await this.executeRequest(`${DropboxDomains.files.file}/get_metadata`, {
            method: 'POST',
            headers: this.getHeaderOptions({ 'Content-Type': 'application/json' }),
            body: this.JSONHeader({ path })
        });

        if (!response.ok) {
            throw new Error('Failed to get file metadata');
        }

        return response.data as DropboxFileMetadata;
    }
}
