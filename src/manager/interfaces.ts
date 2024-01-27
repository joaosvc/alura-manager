export interface DropboxFileResult {
    name: string;
    size: number;
    buffer: Buffer;
}

export interface ZipFileEntry {
    name: string;
    buffer: Buffer | (() => Promise<Buffer>);
}

export interface ExctractedVideoEntryData {
    module: string;
    video: string;
}

export interface WorkerData {
    fileName: string;
    tmpFolder: string;
}

export interface DiscordQueueResult {
    module: string;
    video: string;
    videoFolder: string;
    entryPath: string;
}
export interface DiscordQueueData {
    module: string;
    video: string;
    videoFolder: string;
    entryPath: string;
}

export interface DiscordQueue {
    identifier: string;
    data: DiscordQueueData;
}

export interface DiscordWorkerPromises {
    [identifier: string]: DiscordQueueData[];
}

export interface VideoDatabase {
    [video: string]: string;
}

export interface ModuleDatabase {
    [module: string]: VideoDatabase;
}

export interface CourseDatabase {
    name: string;
    modules: ModuleDatabase;
}

export interface DatabaseInterface {
    [uuid: string]: CourseDatabase;
}

export function ZIP_DECODING_ADM() {
    return 'zip.decoding.adm-zip';
}

export function ZIP_DECODING_YAUZL() {
    return 'zip.decoding.yazul';
}
