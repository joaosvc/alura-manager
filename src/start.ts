import { performance } from 'perf_hooks';
import { ExtendedClient } from './client/extended-client';
import { CourseModules, RunningWorkesInstance } from './types/interfaces';
import { Worker } from 'worker_threads';
import database from './database/database';
import LoggerEntry from './logger/logger-entry';
import Logger from './logger/logger';
import config from '../config';
import * as path from 'path';

export default class StartManager {
    private readonly client: ExtendedClient;
    private readonly logger: Logger;

    private pendingDatabaseQueue: (() => void)[] = [];
    private workesQueue: (() => Promise<void>)[] = [];
    private runningWorkes: Promise<void>[] = [];
    private startWorkerQueueTiming: number = 0;
    private completed: number = 0;
    private maxCompleted: number = 0;
    private entriesCount: number = 0;
    private running: boolean = true;

    private maxRunningWorkes: number = config.maxRunningWorkes;
    private runningWorkesInstance: RunningWorkesInstance = {};

    constructor() {
        this.logger = new Logger(this);
        this.client = new ExtendedClient();
    }

    public static run() {
        new StartManager().start();
    }

    private async prepare(): Promise<void> {
        Promise.all([await database.init(), await this.client.validateAccessTokens()]);

        return Promise.resolve();
    }

    public async start() {
        await this.prepare();

        try {
            const downloadedContentes = database.getAll();
            const filteredContents = Object.entries(database.getContents()).filter(([uuid, file]) => {
                return !downloadedContentes.includes(uuid);
            });

            this.workesQueue = filteredContents.map(
                ([uuid, file]) =>
                    () =>
                        this.startWorker(uuid, file)
            );

            try {
                this.entriesCount = this.workesQueue.length;
                this.startWorkerQueueTiming = this.startTiming();

                this.processWorkerQueue().then(async () => {
                    const endWorkerQueueTiming = this.endTiming(this.startWorkerQueueTiming, false);

                    if (database.count() === database.count(true)) {
                        await this.client.upload(
                            this.client.cursor('names.json'),
                            Buffer.from(
                                JSON.stringify(Object.fromEntries(Object.entries(database.data()).map(([uuid, data]) => [data.name, uuid])), null, 2)
                            )
                        );
                    }

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
        return new Promise<void>((resolve, reject) => {
            const intervalId = setInterval(() => {
                if (this.workesQueue.length > 0) {
                    if (!this.running || (this.maxCompleted > 0 && this.completed >= this.maxCompleted)) {
                        return (this.workesQueue = []);
                    }

                    if (this.runningWorkes.length < this.maxRunningWorkes) {
                        let worker: (() => Promise<void>) | undefined | null = this.workesQueue.shift();

                        if (worker) {
                            this.runningWorkes.push(
                                worker()
                                    .then(() => {
                                        this.completed++;
                                        this.runningWorkes.shift();
                                    })
                                    .catch((error) => {
                                        throw new Error(error.message);
                                    })
                            );

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
                    database.write();
                }
            }, 0);
        });
    }

    private async startWorker(uuid: string, file: string): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            const downloadLogger: LoggerEntry = this.logger.createLogger({ title: '', status: '' });

            downloadLogger.setTitle(`${file.replace('.zip', '')} [%0/%1]`);
            downloadLogger.updateTitle(['%0', '%1'], [0, 0]);

            downloadLogger.updateTitle(['%0', '%1'], [0, 1]);
            downloadLogger.setStatus('Starting worker processes', true);

            const worker = new Worker(path.join(__dirname, 'worker', 'process-worker.js'), {
                workerData: { uuid, file }
            });

            worker.on('message', async (message) => {
                if (message.type) {
                    const { type } = message;

                    if (type === 'logger') {
                        const { method, args } = message;

                        if (method === 'set.title') {
                            downloadLogger.setTitle(args[0], args[1]);
                        } else if (method === 'set.status') {
                            downloadLogger.setStatus(args[0], args[1]);
                        } else if (method === 'update.title') {
                            downloadLogger.updateTitle(args[0], args[1]);
                        } else if (method === 'update.status') {
                            downloadLogger.updateStatus(args[0], args[1]);
                        } else if (method === 'error') {
                            this.logger.error(args[0]);
                        } else if (method === 'success') {
                            this.logger.success(args[0]);
                        }
                    } else if (type === 'data') {
                        const { dataBuffer } = message;

                        if (dataBuffer instanceof ArrayBuffer) {
                            const data: {
                                uuid: string;
                                modules: CourseModules;
                            } = this.client.deserialize(dataBuffer);

                            this.addToDatabaseAsync(data.uuid, data.modules);
                        } else {
                            throw new Error('Invalid data buffer');
                        }
                    } else if (type === 'request-token') {
                        const { tokenType } = message;

                        let token: string | null = null;

                        if (tokenType === 'download') {
                            token = await this.client.getAccessToken('from');
                        } else if (tokenType === 'upload') {
                            token = await this.client.getAccessToken('to');
                        }

                        if (token === null) {
                            throw new Error('Obtaining token for worker failed');
                        }

                        worker.postMessage({ type: 'token', tokenType, token });
                    }
                }
            });

            worker.on('exit', () => {
                this.logger.removeLogger(downloadLogger);

                if (this.runningWorkesInstance[uuid]) {
                    delete this.runningWorkesInstance[uuid];
                }
                resolve();
            });

            worker.on('error', (error) => {
                throw new Error(error.message);
            });

            this.runningWorkesInstance[uuid] = {
                worker: worker,
                logger: downloadLogger
            };
        });
    }

    private updateProcessInfo() {
        this.logger.log(
            [
                '',
                '',
                `${'Running:'.green} ${`${this.runningWorkes.length}`.gray}`,
                `${'Completed:'.green} ${`${this.completed}/${this.entriesCount}`.gray}`,
                `${'Latest downloads:'.green} ${`${database.count()}`.gray}`,
                ``,
                `${'Elapsed time:'.green} ${`${this.endTiming(this.startWorkerQueueTiming, false)}`.gray}`,
                `${'Time left:'.green} ${`${this.calculateRemainingTime()}`.gray}`
            ].join('\n')
        );
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

    public addToDatabaseAsync(uuid: string, data: CourseModules): void {
        this.pendingDatabaseQueue.push(() => database.readAndSetModules(uuid, data));
    }

    public stop() {
        this.running = false;
    }
}

StartManager.run();
