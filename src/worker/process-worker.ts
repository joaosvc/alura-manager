import { isMainThread, parentPort, workerData } from 'worker_threads';
import { CourseModules, ZipFileEntry } from '../types/interfaces';
import { ZipArchive } from '../zip/zip-archive';
import { ExtendedClient } from '../client/extended-client';
import * as path from 'path';
export * from 'colors';

if (isMainThread) {
    throw new Error('This file must be run as a Worker.');
}

class RequestWorker {
    private readonly client: ExtendedClient;
    private readonly zipArchive: ZipArchive;
    private readonly uuid: string = workerData.uuid;
    private readonly file: string = workerData.file;

    private modules: CourseModules = {};

    constructor() {
        this.client = new ExtendedClient();
        this.zipArchive = new ZipArchive();

        this.zipArchive.addReadNamesInclusionHandler((entry: string) => {
            return entry.endsWith('.mp4');
        });
    }

    public static start() {
        new RequestWorker().run();
    }

    private async validateToken(type: 'download' | 'upload'): Promise<void> {
        return new Promise<void>((resolve) => {
            this.requestToken(type);

            parentPort!.once('message', (message) => {
                if (message.type === 'token') {
                    const { tokenType, token } = message;

                    if (tokenType === 'download') {
                        this.client.setAccessToken('from', token);
                    } else if (tokenType === 'upload') {
                        this.client.setAccessToken('to', token);
                    } else {
                        throw new Error('Invalid token type');
                    }

                    return resolve();
                }

                throw new Error('First message should be a token');
            });
        });
    }

    public async run(): Promise<void> {
        this.logger('set.status', 'Downloading the zip file...', true);
        this.logger('update.title', ['%0', '%1'], ['0', '1']);

        try {
            await this.validateToken('download');

            this.zipArchive
                .readZipFileEntries((await this.client.download(this.client.cursor(this.file))).fileBuffer!)
                .then(async (entries) => {
                    this.sortEntries(entries);

                    this.logger('set.status', `Processing zip file, please wait...`, true);

                    this.processEntriesQueue(entries).then(async () => {
                        this.logger('update.title', ['%0', '%1'], ['0', '1']);
                        this.logger('set.status', 'Sending data...', true);

                        this.data(
                            this.client.serialize({
                                uuid: this.uuid,
                                modules: this.modules
                            })
                        );

                        this.logger('set.status', `Finished`, true);
                        process.exit(0);
                    });
                })
                .catch((error) => {
                    throw new Error(`An error occurred while processing: ${error.message}`);
                });
        } catch (error: any) {
            throw new Error(`An error occurred while processing: ${error.message}`);
        }
    }

    private async processEntriesQueue(entries: ZipFileEntry[]): Promise<void> {
        return new Promise<void>(async (resolve) => {
            const process = { count: 0, total: entries.length };

            this.logger('update.title', ['%0', '%1'], [process.count, process.total]);
            this.logger('set.status', 'Processing entries...', true);

            while (entries.length > 0) {
                const { name, buffer }: ZipFileEntry = entries.shift()!;
                const { module, video } = this.extractDataFrom(name);

                const videoIdentifier = video.replace('.mp4', '');
                const videoPath = path.join(this.uuid, module, video);

                this.logger('set.status', `Sending module: ${module} video: ${videoIdentifier}`, true);

                await this.validateToken('upload');
                await this.client.upload(this.client.cursor(videoPath), buffer instanceof Buffer ? buffer : await buffer());

                if (!this.modules[module]) {
                    this.modules[module] = {};
                }

                this.modules[module][videoIdentifier] = videoPath;

                this.logger('update.title', ['%0', '%1'], [++process.count, process.total]);
            }

            if (process.count !== process.total) {
                throw new Error('The number of entries processed does not match the total quantity');
            }
            this.logger('set.status', 'All entries has been processed!', true);

            resolve();
        });
    }

    private extractDataFrom(entryName: string): { module: string; video: string } {
        const regex: RegExp = /\/(\d+)\/([^\/]+)$/;
        const match: RegExpMatchArray | null = entryName.match(regex);

        if (!match) {
            throw new Error('Invalid path format. Unable to extract module and video.');
        }

        return {
            module: match[1],
            video: match[2]
        };
    }

    private sortEntries(entries: ZipFileEntry[]): void {
        entries.sort((entryA, entryB) => {
            const dataA = this.extractDataFrom(entryA.name);
            const dataB = this.extractDataFrom(entryB.name);

            if (dataA && dataB) {
                const moduleComparison = parseInt(dataA.module) - parseInt(dataB.module);
                return moduleComparison !== 0 ? moduleComparison : dataA.video.localeCompare(dataB.video);
            } else {
                return 0;
            }
        });
    }

    private logger(method: string, ...args: any[]): void {
        parentPort!.postMessage({
            type: 'logger',
            method: method,
            args: args
        });
    }

    private data(buffer: ArrayBuffer): void {
        parentPort!.postMessage({
            type: 'data',
            dataBuffer: buffer
        });
    }

    private requestToken(type: string): void {
        parentPort!.postMessage({
            type: 'request-token',
            tokenType: type
        });
    }
}

RequestWorker.start();
