import Logger from "./logger";

export default class LoggerEntry {
    private baseTitle: string;
    private baseStatus: string;
    private baseLog: string;

    constructor(
        private readonly loggerInstance: Logger,
        private readonly options: LoggerEntryOptions,
        private readonly id: number
    ) {
        this.baseTitle = this.options.title;
        this.baseStatus = this.options.status;
        this.baseLog = this.options.log;
    }

    public updateTitle(args: string[], replace: Array<string | number>): LoggerEntry {
        let title = this.baseTitle;

        args.forEach((arg, index) => {
            const replacement = replace[index];

            title = title.replace(arg, replacement.toString());
        });

        this.options.title = title;
        this.loggerInstance.waitingRefresh();
        return this;
    }

    public updateStatus(args: string[], replace: Array<string | number>): LoggerEntry {
        let status = this.baseStatus;

        args.forEach((arg, index) => {
            const replacement = replace[index];

            status = status.replace(arg, replacement.toString());
        });

        this.options.status = status;
        this.loggerInstance.waitingRefresh();
        return this;
    }

    public updateLog(args: string[], replace: Array<string | number>): LoggerEntry {
        let log = this.baseLog;

        args.forEach((arg, index) => {
            const replacement = replace[index];

            log = log.replace(arg, replacement.toString());
        });

        this.options.log = log;
        this.loggerInstance.waitingRefresh();
        return this;
    }

    public setTitle(title: string, update: boolean = false): LoggerEntry {
        this.baseTitle = 'Task: '.white + title.green;

        if (update) {
            this.options.title = this.baseTitle;
        }
        this.loggerInstance.waitingRefresh();
        return this;
    }

    public setStatus(status: string, update: boolean = false): LoggerEntry {
        this.baseStatus = 'Status: '.white + status.gray;

        if (update) {
            this.options.status = this.baseStatus;
        }
        this.loggerInstance.waitingRefresh();
        return this;
    }

    public setLog(log: string, update: boolean = false): LoggerEntry {
        this.baseLog = 'Upload: '.white + log.gray;

        if (update) {
            this.options.log = this.baseLog;
        }
        this.loggerInstance.waitingRefresh();
        return this;
    }

    public getTitle(): string {
        return this.options.title;
    }

    public getStatus(): string {
        return this.options.status;
    }

    public getLog(): string {
        return this.options.log;
    }

    public getOptionsString(): string {
        return Object.values(this.options).filter(value => value).join('\n');
    }

    public getId() {
        return this.id
    }
}

export interface LoggerEntryOptions {
    title: string;
    status: string;
    log: string;
}