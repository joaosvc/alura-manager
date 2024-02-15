import { Worker } from 'worker_threads';
import LoggerEntry from '../logger/logger-entry';

export interface ZipFileEntry {
    name: string;
    buffer: Buffer | (() => Promise<Buffer>);
}

export interface WorkerData {
    uuid: string;
    file: string;
    tmpFolder: string;
}

export interface CourseModules {
    [module: string]: {
        [video: string]: string;
    };
}

export interface CourseDatabase {
    name: string;
    icon: string;
    category: {
        name: string;
        module: string;
    };
    modules: CourseModules;
}

export interface DatabaseType {
    [uuid: string]: CourseDatabase;
}

export interface ContentUuids {
    [uuid: string]: string;
}

export interface RunningWorkesInstance {
    [uuid: string]: {
        worker: Worker;
        logger: LoggerEntry;
    };
}

export function ZIP_DECODING_ADM() {
    return 'zip.decoding.adm-zip';
}

export function ZIP_DECODING_YAUZL() {
    return 'zip.decoding.yazul';
}

export interface CourseModulesWithURL {
    [module: string]: {
        [video: string]: {
            path: string;
            url: string;
        };
    };
}

export interface DatabaseWithURLType {
    [uuid: string]: {
        name: string;
        icon: string;
        category: {
            name: string;
            module: string;
        };
        modules: CourseModulesWithURL;
    };
}
