import { isMainThread, parentPort } from 'worker_threads';
import { ExtendedClient } from '../../structs/types/ExtendedClient';
import { DiscordQueue, DiscordQueueData, DiscordWorkerPromises } from '../interfaces';
import * as fs from 'fs';
import * as path from 'path';
export * from 'colors';

if (isMainThread) {
    throw new Error('This file must be run as a Worker.');
}

class DiscordWorker {
    private readonly client: ExtendedClient;
    private runningPromises: DiscordWorkerPromises = {};

    constructor() {
        this.client = new ExtendedClient();
    }

    public async run(): Promise<void> {
        this.waitQueueData();

        setInterval(() => null, 1000);
    }

    private startQueue(queueData: DiscordQueue): void {
        const { identifier, data } = queueData;

        if (!this.runningPromises[identifier]) {
            this.runningPromises[identifier] = [data];

            this.queuePromise(identifier);
        } else {
            this.runningPromises[identifier].push(data);
        }
    }

    private async queuePromise(identifier: string): Promise<void> {
        return new Promise<void>(async (resolve) => {
            try {
                while (this.runningPromises[identifier].length > 0) {
                    const queueData = this.runningPromises[identifier].shift()!;

                    this.result(identifier, await this.uploadPlaylist(identifier, queueData));
                }

                this.logger(identifier, 'set.log', 'Waiting for hls files', true);
                delete this.runningPromises[identifier];

                resolve();
            } catch (error: any) {
                this.logger(identifier, 'set.log', `${error}`.red, true);
                this.logger(identifier, 'error', error);
                this.reject();
            }
        });
    }

    private async uploadPlaylist(identifier: string, data: DiscordQueueData): Promise<ArrayBuffer> {
        return new Promise<ArrayBuffer>(async (resolve, reject) => {
            const { module, video, videoFolder, entryPath } = data;

            this.logger(identifier, 'set.log', `Preparing to send the module: ${module} video: ${video}`, true);

            let videoPlaylist: string = await fs.promises.readFile(entryPath, 'utf-8');
            let segments: string[] = (await fs.promises.readdir(videoFolder)).filter((file) => file.endsWith('.ts'));

            let uploadedCount = 0;
            let uploadCount = segments.length;
            let loggerMessage = `Sending module: ${module} video: ${video} - [%0/%1] [%2]`;

            this.logger(identifier, 'set.log', loggerMessage);

            try {
                this.logger(identifier, 'update.log', ['%0', '%1', '%2'], [0, uploadCount, 0]);

                const concurrencyLimit = 45;
                const segmentChunks = this.client.chunkArray(segments, concurrencyLimit);

                const processChunk = async (chunk: string[]) => {
                    while (chunk.length > 0) {
                        const segmentName = chunk.shift()!;
                        const segmentPath = path.join(videoFolder, segmentName);
                        const segmentUuid = segmentName.replace('.ts', '');
                        const onHold = this.runningPromises[identifier].length;

                        videoPlaylist = videoPlaylist.replace(
                            segmentName,
                            await this.uploadFile(identifier, loggerMessage, segmentPath, segmentUuid)
                        );

                        this.logger(identifier, 'update.log', ['%0', '%1', '%2'], [++uploadedCount, uploadCount, onHold]);
                    }
                };

                await Promise.all(segmentChunks.map((chunk) => processChunk(chunk)));

                resolve(
                    this.client.serialize({
                        module: module,
                        video: video,
                        videoFolder,
                        playlist: videoPlaylist
                    })
                );

                segmentChunks.length = 0;
                segments.length = 0;
            } catch (error: any) {
                reject(error.message);
            }

            segments.length = 0;
        });
    }

    private async uploadFile(
        identifier: string,
        loggerMessage: string,
        path: string,
        uuid: string,
        currentAttempt: number = 0
    ): Promise<string> {
        const { status, result } = await this.client.uploadDiscordFile(path, uuid, currentAttempt);

        if (status === 'retry') {
            this.logger(identifier, 'set.log', `${result}`, true);
            await this.client.delay(2000);

            return await this.uploadFile(identifier, loggerMessage, path, uuid, ++currentAttempt);
        }

        if (currentAttempt > 0) {
            this.logger(identifier, 'set.log', loggerMessage);
        }

        return result!;
    }

    private waitQueueData(): void {
        parentPort!.on('message', (message) => {
            if (message.type) {
                const { type } = message;

                if (type === 'queue-data') {
                    this.startQueue(message.queueData);
                }
            }
        });
    }

    private logger(identifier: string, method: string, ...args: any[]): void {
        parentPort!.postMessage({
            type: 'logger',
            identifier: identifier,
            method: method,
            args: args
        });
    }

    private reject(): void {
        parentPort!.postMessage({ type: 'reject' });
    }

    private result(identifier: string, result: ArrayBuffer): void {
        parentPort!.postMessage({
            type: 'result',
            identifier: identifier,
            result: result
        });
    }
}

new DiscordWorker().run();
