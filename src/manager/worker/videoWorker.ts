import { isMainThread, parentPort, workerData } from 'worker_threads';
import { DiscordQueueData, ExctractedVideoEntryData, ModuleDatabase, ZIP_DECODING_ADM, ZIP_DECODING_YAUZL } from '../interfaces';
import { ExtendedClient } from '../../structs/types/ExtendedClient';
import { ZipFileEntry } from '../interfaces';
import { promises as fsPromises } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import config from '../../../config';
import AdmZip from 'adm-zip';
import ffmpeg from 'fluent-ffmpeg';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as yauzl from 'yauzl';
export * from 'colors';

if (isMainThread) {
    throw new Error('This file must be run as a Worker.');
}

class RequestWorker {
    private readonly client: ExtendedClient;

    private fileName: string = workerData.fileName;
    private tmpFolder: string = workerData.tmpFolder;
    private writeFileBufferReading: boolean = true;
    private zipDecodingType: string = ZIP_DECODING_YAUZL();
    private modulesData: ModuleDatabase = {};

    private sendedDiscordDataCount: number = 0;
    private receivedDiscordDataCount: number = 0;

    constructor() {
        this.client = new ExtendedClient();

        dotenv.config();

        if (process.platform === 'win32') {
            ffmpeg.setFfmpegPath(`${config.ffmpegWindowsPath}/ffmpeg.exe`);
            ffmpeg.setFfprobePath(`${config.ffmpegWindowsPath}/ffprobe.exe`);
        }
    }

    public static start() {
        new RequestWorker().run();
    }

    public async run(): Promise<void> {
        this.logger('set.status', 'Downloading the zip file...', true);
        this.logger('update.title', ['%0', '%1'], ['0', '1']);

        try {
            let fileBuffer: Buffer | null = (await this.client.getFile(this.client.cursor(this.fileName))).buffer;

            this.logger('set.status', `Processing zip file, please wait...`, true);

            this.readZipFileEntries(fileBuffer)
                .then(async (entries) => {
                    this.sortEntries(entries);

                    this.waitDiscordResult();
                    this.logger('set.log', 'Waiting for hls files', true);

                    this.processVideoEntriesQueue(entries)
                        .then(async () => {
                            await this.checkDiscordResult();

                            this.logger('update.title', ['%0', '%1'], ['0', '1']);
                            this.logger('set.status', 'Sending hls playlist...', true);
                            this.logger('set.log', 'Finished', true);

                            this.data(
                                this.client.serialize({
                                    uuid: uuidv4(),
                                    playlist: {
                                        name: this.fileName.replace('.zip', ''),
                                        modules: this.modulesData
                                    }
                                })
                            );

                            this.logger('set.status', `Finished`, true);

                            process.exit(0);
                        })
                        .catch((error) => {
                            this.debugError(error, true, true);
                        });
                })
                .catch((error) => {
                    this.debugError(error, true, true);
                });

            fileBuffer = null;
        } catch (error: any) {
            this.debugError(`An error occurred while processing: ${error.message}`, true, true);
        }
    }

    private async checkDiscordResult(): Promise<void> {
        return new Promise<void>((resolve) => {
            const checkInterval = setInterval(() => {
                if (this.sendedDiscordDataCount === this.receivedDiscordDataCount) {
                    clearInterval(checkInterval);

                    resolve();
                }
            }, 0);
        });
    }

    private async processVideoEntriesQueue(entries: ZipFileEntry[]): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            let processedCount = 0;
            let processCount = entries.length;

            this.logger('set.status', 'Creating hls playlist...');
            this.logger('update.title', ['%0', '%1'], [processedCount, processCount]);

            try {
                while (entries.length > 0) {
                    let videoEntry: ZipFileEntry | null = entries.shift()!;

                    if (videoEntry) await this.processVideoEntry(videoEntry);

                    this.logger('update.title', ['%0', '%1'], [++processedCount, processCount]);

                    videoEntry = null;
                }
                this.logger('set.status', 'Hls playlists created', true);

                resolve();
            } catch (error: any) {
                reject(error);
            }
        });
    }

    private async processVideoEntry(videoEntry: ZipFileEntry | null): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            if (videoEntry) {
                const extractedEntryData = this.extractVideoEntryData(videoEntry.name);

                if (!extractedEntryData) {
                    return reject('Invalid path format. Unable to extract module and video.');
                }
                const { module, video } = extractedEntryData;

                const fileUuid: string = uuidv4();
                const entryUuid: string = uuidv4();

                const videoIdentifier: string = video.replace('.mp4', '');

                const videoFolder: string = path.join(this.tmpFolder, fileUuid);
                const videoPath: string = path.join(videoFolder, `${entryUuid}.mp4`);
                const entryPath: string = path.join(videoFolder, `${entryUuid}.m3u8`);

                this.logger('set.status', `Processing module: ${module} video: ${video} | %0`, true);

                await fsPromises.mkdir(videoFolder, { recursive: true });

                if (videoEntry.buffer instanceof Buffer) {
                    await fsPromises.writeFile(videoPath, videoEntry.buffer);
                } else {
                    await fsPromises.writeFile(videoPath, await videoEntry.buffer());
                }
                videoEntry = null;

                this.createPlaylist(videoPath, entryPath)
                    .then(() => {
                        this.discordQueue({
                            module: module,
                            video: videoIdentifier,
                            videoFolder: videoFolder,
                            entryPath: entryPath
                        });
                        resolve();
                    })
                    .catch((error) => {
                        reject(error);
                    });
            }
        });
    }

    private async createPlaylist(videoPath: string, entryPath: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const ffmpegCommand = ffmpeg(videoPath);

            ffmpegCommand.output(entryPath);
            ffmpegCommand.inputFormat('mp4');
            ffmpegCommand.outputFormat('hls');
            ffmpegCommand.videoCodec('libx264');
            ffmpegCommand.audioCodec('aac');
            ffmpegCommand.addOption('-threads', 'auto');
            ffmpegCommand.addOption('-preset', 'ultrafast');
            ffmpegCommand.addOption('-start_number', '0');
            ffmpegCommand.addOption('-hls_time', '10');
            ffmpegCommand.addOption('-hls_list_size', '0');
            ffmpegCommand.addOption('-s', '1280x720');

            ffmpegCommand.on('progress', (progress) => {
                const progressPercent = Math.floor(progress.percent);

                this.logger('update.status', ['%0'], [`${progressPercent}%`]);
            });
            ffmpegCommand.on('end', () => resolve());
            ffmpegCommand.on('error', (error) => reject(error.message));

            ffmpegCommand.run();
        });
    }

    private async readZipFileEntries(fileBuffer: Buffer): Promise<ZipFileEntry[]> {
        return new Promise<ZipFileEntry[]>((resolve, reject) => {
            if (this.zipDecodingType === ZIP_DECODING_YAUZL()) {
                this.yauzlFromBuffer(fileBuffer)
                    .then((entries) => {
                        resolve(entries);
                    })
                    .catch((error) => {
                        reject(error);
                    });
            } else if (this.zipDecodingType === ZIP_DECODING_ADM()) {
                this.admZipFromBuffer(fileBuffer)
                    .then((entries) => {
                        resolve(entries);
                    })
                    .catch((error) => {
                        reject(error);
                    });
            } else {
                reject('Unable to find zip decryption type');
            }
        });
    }

    private async admZipFromBuffer(fileBuffer: Buffer): Promise<ZipFileEntry[]> {
        return new Promise<ZipFileEntry[]>((resolve, reject) => {
            const entries: ZipFileEntry[] = [];

            try {
                let zip: AdmZip | null = new AdmZip(fileBuffer);

                const entryPromises: Promise<void>[] | null = zip.getEntries().map((entry) => {
                    return new Promise<void>((resolveEntry, rejectEntry) => {
                        if (entry.entryName.endsWith('.mp4')) {
                            const writeBuffer = async () => {
                                return new Promise<Buffer>((resolveWrite, rejectWrite) => {
                                    entry.getDataAsync((entryBuffer: Buffer, error: string) => {
                                        if (error) {
                                            return rejectWrite(
                                                `Error opening read stream for entry ${entry.entryName}: ${error}`
                                            );
                                        }

                                        resolveWrite(entryBuffer);
                                    });
                                });
                            };

                            if (this.writeFileBufferReading) {
                                writeBuffer()
                                    .then((buffer) => {
                                        entries.push({
                                            name: entry.entryName,
                                            buffer: buffer
                                        });

                                        resolveEntry();
                                    })
                                    .catch((error) => {
                                        rejectEntry(error);
                                    });
                            } else {
                                entries.push({
                                    name: entry.entryName,
                                    buffer: writeBuffer
                                });

                                resolveEntry();
                            }
                        } else {
                            resolveEntry();
                        }
                    });
                });

                Promise.all(entryPromises)
                    .then(() => {
                        resolve(entries);

                        entries.length = 0;
                    })
                    .catch((error) => reject(error));

                entryPromises.length = 0;
            } catch (error) {
                reject(`Error during ZIP reading: ${error}`);
            } finally {
                entries.length = 0;
            }
        });
    }

    private async yauzlFromBuffer(fileBuffer: Buffer): Promise<ZipFileEntry[]> {
        return new Promise<ZipFileEntry[]>((resolve, reject) => {
            yauzl.fromBuffer(fileBuffer, { lazyEntries: true }, async (error, file) => {
                if (error) {
                    return reject(`Error opening ZIP: ${error}`);
                }

                const entryPromises: Promise<ZipFileEntry>[] = [];

                file.readEntry();
                file.on('entry', async (entry: yauzl.Entry) => {
                    if (entry.fileName.endsWith('.mp4')) {
                        entryPromises.push(
                            this.yauzlReadEntryContent(file, entry).then((buffer) => ({
                                name: entry.fileName,
                                buffer
                            }))
                        );
                    }

                    file.readEntry();
                });

                file.on('end', async () => {
                    try {
                        resolve(await Promise.all(entryPromises));
                    } catch (err) {
                        reject(`Error processing entries: ${err}`);
                    } finally {
                        file.close();

                        entryPromises.length = 0;
                    }
                });

                file.on('error', (error) => {
                    reject(`Error during ZIP reading: ${error}`);
                });
            });
        });
    }

    private async yauzlReadEntryContent(file: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer | (() => Promise<Buffer>)> {
        return new Promise<Buffer | (() => Promise<Buffer>)>((resolve, reject) => {
            let writeBuffer = async () =>
                new Promise<Buffer>((resolve, reject) => {
                    file.openReadStream(entry, (error, readStream) => {
                        if (error) {
                            return reject(`Error opening read stream for entry ${entry.fileName}: ${error}`);
                        }
                        const chunks: Buffer[] = [];

                        readStream.on('data', (chunk) => {
                            chunks.push(chunk);
                        });

                        readStream.on('end', () => {
                            resolve(Buffer.concat(chunks));

                            chunks.length = 0;
                        });

                        readStream.on('error', (error) => {
                            reject(`Error reading stream for entry ${entry.fileName}: ${error}`);
                        });
                    });
                });

            if (this.writeFileBufferReading) {
                writeBuffer()
                    .then((buffer) => {
                        resolve(buffer);
                    })
                    .catch((error) => {
                        reject(error);
                    });
            } else {
                resolve(writeBuffer);
            }
        });
    }

    private async removeFolderAsync(path: string): Promise<void> {
        if (fs.existsSync(path)) {
            await fsPromises.rm(path, { recursive: true });
        }
    }

    private waitDiscordResult(): void {
        parentPort!.on('message', (message) => {
            if (message.type === 'discord-result') {
                const { module, video, videoFolder, playlist } = this.client.deserialize(message.result);

                if (!this.modulesData[module]) {
                    this.modulesData[module] = {};
                }

                this.modulesData[module][video] = playlist;
                this.removeFolderAsync(videoFolder);

                this.receivedDiscordDataCount++;
            }
        });
    }

    private extractVideoEntryData(entryName: string): ExctractedVideoEntryData | null {
        const regex: RegExp = /\/(\d+)\/([^\/]+)$/;
        const match: RegExpMatchArray | null = entryName.match(regex);

        if (match) {
            const module: string = match[1];
            const video: string = match[2];

            return { module, video };
        } else {
            return null;
        }
    }

    private sortEntries(entries: ZipFileEntry[]): void {
        entries.sort((entryA, entryB) => {
            const dataA = this.extractVideoEntryData(entryA.name);
            const dataB = this.extractVideoEntryData(entryB.name);

            if (dataA && dataB) {
                const moduleComparison = parseInt(dataA.module) - parseInt(dataB.module);
                return moduleComparison !== 0 ? moduleComparison : dataA.video.localeCompare(dataB.video);
            } else {
                return 0;
            }
        });
    }

    private debugError(message: string, log: boolean = true, reject: boolean = false): void {
        this.logger('set.status', message.red, true);

        if (log) {
            this.logger('error', message.red);
        }

        if (reject) {
            this.promise('reject');
        }
    }

    private logger(method: string, ...args: any[]): void {
        parentPort!.postMessage({
            type: 'logger',
            method: method,
            args: args
        });
    }

    private promise(response: string): void {
        parentPort!.postMessage({
            type: 'promise',
            response: response
        });
    }

    private data(buffer: ArrayBuffer): void {
        parentPort!.postMessage({
            type: 'data',
            dataBuffer: buffer
        });
    }

    private discordQueue(data: DiscordQueueData): void {
        parentPort!.postMessage({
            type: 'discord-queue',
            data: data
        });

        this.sendedDiscordDataCount++;
    }
}

RequestWorker.start();
