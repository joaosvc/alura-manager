import { createInterface, Interface } from 'readline';
import LoggerEntry, { LoggerEntryOptions } from './loggerEntry';
import VideoRequester from '../../start';
export * from 'colors';

export default class Logger {
    private readLine: Interface;
    private entries: LoggerEntry[] = [];
    private logMessage: string = '';
    private message: string = '';
    private tryRefresh: boolean = false;

    constructor(request: VideoRequester) {
        this.readLine = createInterface({
            input: process.stdin,
            output: process.stdout
        });

        this.readLine.on('line', input => {
            if (input.toLocaleLowerCase() === 'stop') {
                this.success('Canceling process, please wait...');

                request.stop();
            }
        });
        setInterval(() => {
            if (this.tryRefresh) {
                this.refresh();
            }
        }, 500);
    }

    createLogger(options: LoggerEntryOptions): LoggerEntry {
        const loggerEntry = new LoggerEntry(this, options, this.createId());

        this.entries.push(loggerEntry);
        return loggerEntry;
    }

    waitingRefresh() {
        this.tryRefresh = true;
    }

    refresh(clear: boolean = true) {
        if (clear) {
            this.clearConsole();
        }

        console.log(this.entries.map(entry => {
            return entry.getOptionsString()
        }).join('\n\n') + `${this.logMessage}`.green + '\n\nLog ' + `> ${`${this.message}`.white}`.green + '\n\nInput:'.green);

        this.tryRefresh = false;
    }

    log(message: any, ...args: any[]) {
        this.logMessage = `${`${message}`.green} ${args.join(' ')}`;
        this.waitingRefresh();
    }

    success(message: any, ...args: any[]) {
        this.message = `${`${message}`.green} ${args.join(' ')}`;
        this.waitingRefresh();
    }

    error(message: any, ...args: any[]) {
        this.message = `${`${message}`.red} ${args.join(' ')}`;
        this.waitingRefresh();
    }

    removeLogger(loggerEntry: LoggerEntry) {
        const index = this.entries.indexOf(loggerEntry);

        if (index !== -1) {
            this.entries.splice(index, 1);
            this.waitingRefresh();
        }
    }

    getLogger(id: number): LoggerEntry | null {
        const foundLogger = this.entries.find(entry => entry.getId() === id);

        return foundLogger || null;
    }

    createId(): number {
        return this.entries.length;
    }

    getEntriesCount() {
        return this.entries.length;
    }

    clearLines() {
        this.entries = [];
        this.clearConsole();
    }

    clearConsole() {
        process.stdout.write('\x1Bc');
        process.stdout.write('\x1B[1B');
    }
}