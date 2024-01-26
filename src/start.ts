import { performance } from 'perf_hooks';
import { ExtendedClient } from './structs/types/ExtendedClient';
import { DiscordQueueData, PlaylistData } from './manager/interfaces';
import { Worker } from 'worker_threads';
import database from './manager/database/database';
import fsExtra from 'fs-extra';
import LoggerEntry from './manager/logger/loggerEntry';
import Logger from './manager/logger/logger';
import * as path from 'path';
import * as fs from 'fs';
import config from '../config';

export default class Start {
    private readonly client: ExtendedClient;
    private readonly logger: Logger;
    private pendingDatabaseQueue: (() => void)[] = [];
    private workesQueue: (() => Promise<void>)[] = [];
    private runningWorkes: Promise<void>[] = [];
    private discordWork: Worker | undefined;
    private startWorkerQueueTiming: number = 0;
    private completed: number = 0;
    private maxCompleted: number = 0;
    private entriesCount: number = 0;
    private tmpFolder: string;
    private running: boolean = true;
    
    private maxRunningWorkes: number = config.maxRunningWorkes;
    private runningWorkesInstance: { [name: string]: { 
        worker: Worker, 
        logger: LoggerEntry 
    }} = {};

    constructor() {
        this.logger = new Logger(this);
        this.client = new ExtendedClient();

        this.tmpFolder = path.join(path.resolve(__dirname, '../../'), 'tmp');
        
        if (fs.existsSync(this.tmpFolder)) {
            fsExtra.removeSync(this.tmpFolder);
        }
    }

    public static run() {
        new Start().start();
    }

    public async start() {
        try {
            await database.init();

            const contents = await this.client.listContents(null, true);
            
            const downloadedContentes = database.getAllPlaylistNames();
            const filteredContents = contents.filter(entry => entry.name.endsWith('.zip') && !downloadedContentes.includes(`${entry.name.replace('.zip', '')}`));

            this.workesQueue = filteredContents.map(
                (fileEntry) => () => this.startWorker(fileEntry.name)
            );

            try {
                this.startDiscordWorker();
                
                this.entriesCount = this.workesQueue.length;
                this.startWorkerQueueTiming = this.startTiming();
                                
                this.processWorkerQueue().then(() => {
                    const endWorkerQueueTiming = this.endTiming(this.startWorkerQueueTiming, false);

                    this.logger.success(`Done! ${endWorkerQueueTiming}`.green);
                });
            } catch (error: any) {
                this.logger.error(`An error occurred in the workers: ${error.message}`.red);
            }
        } catch (error: any) {
            this.logger.error(`Error retrieving file list: ${error.message}`.red);
        }
    }

    private async processWorkerQueue(): Promise<void> {
        return new Promise<void>((resolve) => {
            const intervalId = setInterval(() => {
                if (this.workesQueue.length > 0) {
                    if (!this.running || (this.maxCompleted > 0 && this.completed >= this.maxCompleted)) {
                        return this.workesQueue = [];
                    }

                    if (this.runningWorkes.length < this.maxRunningWorkes) {
                        let worker: (() => Promise<void>) | undefined | null = this.workesQueue.shift();
        
                        if (worker) {
                            this.runningWorkes.push(worker().then(() => {
                                this.completed++;
                                this.runningWorkes.shift();
                            }).catch(() => {
                                this.logger.refresh();
                                
                                process.exit(1);
                            }));
        
                            worker = null;
                        }
                    }
                } else if (this.runningWorkes.length <= 0) {
                    clearInterval(intervalId);
                    resolve();
                }
    
                this.updateProcessInfo();

                if (this.pendingDatabaseQueue.length > 0) {
                    while (this.pendingDatabaseQueue.length > 0) {
                        this.pendingDatabaseQueue.shift()!();
                    }
                    database.writeData();
                }
            }, 0);
        });
    }

    private async startWorker(fileName: string): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            const downloadLogger: LoggerEntry = this.logger.createLogger({ title: '', status: '', log: ''});

            downloadLogger.setTitle(`${fileName.replace('.zip', '')} [%0/%1]`);
            downloadLogger.updateTitle(['%0', '%1'], [0, 0]);

            try {
                downloadLogger.updateTitle(['%0', '%1'], [0, 1]);
                downloadLogger.setStatus('Starting worker processes', true);

                const worker = new Worker(path.join(__dirname, 'manager', 'worker', 'videoWorker.js'), {
                    workerData: {
                        fileName: fileName,
                        tmpFolder: this.tmpFolder
                    }
                });
        
                worker.on('message', async message => {
                    if (message.type) {
                        const { type } = message;

                        if (type === 'logger') {
                            this.workerLogger(downloadLogger, message);
                        } else if (type === 'promise') {
                            const { response } = message;

                            if (response === 'resolve') {
                                this.logger.removeLogger(downloadLogger);
                                resolve();
                            } else if (response === 'reject') {
                                reject();
                            }
                        } else if (type === 'data') {
                            const { dataBuffer } = message;

                            if (dataBuffer instanceof ArrayBuffer) {
                                const data: { 
                                    uuid: string;
                                    playlist: PlaylistData;
                                } = this.client.deserialize(dataBuffer);

                                this.addToDatabaseAsync(data.uuid, data.playlist);
                            }
                        } else if (type === 'discord-queue') {
                            this.discordQueue(fileName, message.data);
                        }
                    }
                });
        
                worker.on('exit', () => {
                    this.logger.removeLogger(downloadLogger);

                    if (this.runningWorkesInstance[fileName]) {
                        delete this.runningWorkesInstance[fileName];
                    }
                    resolve();
                });
        
                worker.on('error', error => reject(error));

                this.runningWorkesInstance[fileName] = {
                    worker: worker,
                    logger: downloadLogger
                };
            } catch (error: any) {
                const errorMessage = `An error occurred while processing: ${error.message}`;
                
                downloadLogger.setStatus(errorMessage.red, true);
                this.logger.error(errorMessage);
                reject();
            }
        });
    }

    private startDiscordWorker(): void {
        const worker = new Worker(path.join(__dirname, 'manager', 'worker', 'discordWorker.js'));

        worker.on('message', async message => {
            if (message.type) {
                const { type } = message;

                if (type === 'result') {
                    const { identifier, result } = message;

                    if (this.runningWorkesInstance[identifier]) {
                        this.runningWorkesInstance[identifier].worker.postMessage({
                            type: 'discord-result',
                            result: result
                        });
                    }
                } else if (type === 'logger') {
                    const { identifier } = message;

                    if (this.runningWorkesInstance[identifier]) {
                        delete message.identifier;
                        
                        this.workerLogger(this.runningWorkesInstance[identifier].logger, message);
                    }
                } else if (type === 'reject') {
                    this.logger.refresh();
                                
                    process.exit(1);
                }
            }
        });

        this.discordWork = worker;
    }

    private discordQueue(workIdentifier: string, data: DiscordQueueData): void {
        if (!this.discordWork) {
            throw new Error('Discord worker is not running');
        }

        this.discordWork.postMessage({
            type: 'queue-data',
            queueData: {
                identifier: workIdentifier,
                data: data
            }
        });
    }

    private workerLogger(logger: LoggerEntry, message: any): void {
        const { method, args } = message;

        if (method === 'set.title') {
            logger.setTitle(args[0], args[1]);
        } else if (method === 'set.status') {
            logger.setStatus(args[0], args[1]);
        } else if (method === 'set.log') {
            logger.setLog(args[0], args[1]);
        } else if (method === 'update.title') {
            logger.updateTitle(args[0], args[1]);
        } else if (method === 'update.status') {
            logger.updateStatus(args[0], args[1]);
        } else if (method === 'update.log') {
            logger.updateLog(args[0], args[1]);
        } else if (method === 'error') {
            this.logger.error(args[0]);
        } else if (method === 'success') {
            this.logger.success(args[0]);
        }
    }

    private updateProcessInfo() {
        this.logger.log(['', '',
            `${'Running:'.green} ${`${this.runningWorkes.length}`.gray}`, 
            `${'Completed:'.green} ${`${this.completed}/${this.entriesCount}`.gray}`,
            `${'Latest downloads:'.green} ${`${database.getDataCount()}`.gray}`,
            ``,
            `${'Elapsed time:'.green} ${`${this.endTiming(this.startWorkerQueueTiming, false)}`.gray}`, 
            `${'Time left:'.green} ${`${this.calculateRemainingTime()}`.gray}`,
        ].join('\n'));
    }

    private calculateRemainingTime(): string {
        if (this.completed <= 0) {
            return 'calculating...';
        }
    
        const elapsedTime = performance.now() - this.startWorkerQueueTiming;
        const remainingEntries = this.entriesCount - this.completed;
        const averageTimePerEntry = elapsedTime / this.completed;
        const remainingTime = remainingEntries * averageTimePerEntry;
    
        return this.getPerformanceTime(remainingTime, false);
    }

    private getPerformanceTime(time: number, str: boolean = true): string {
        const days = Math.floor(time / 86400000); 
        const hours = Math.floor((time % 86400000) / 3600000);
        const minutes = Math.floor((time % 3600000) / 60000);
        const seconds = Math.floor((time % 60000) / 1000);
    
        return `${str ? 'Time: ' : ''}${days > 0 ? days + 'd ' : ''}${hours > 0 ? hours + 'h ' : ''}${minutes}m ${seconds}s`;
    }

    private startTiming(): number {
        return performance.now();
    }

    private endTiming(startTiming: number, str: boolean = true): string {
        return this.getPerformanceTime(performance.now() - startTiming, str);
    }
    
    public addToDatabaseAsync(uuid: string, data: PlaylistData): void {
        this.pendingDatabaseQueue.push(() => database.set(uuid, data));
    }

    public stop() {
        this.running = false;
    }
}

Start.run();