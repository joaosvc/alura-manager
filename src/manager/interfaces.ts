export interface DropboxFileResult {
    name: string;
    size: number;
    buffer: Buffer;
}

export interface HLSPlaylistData {
    uuid: string;
    name: string;
    entries: any;
}

export interface DownloadQueueFileData {
    fileName: string;
    loggerId: number;
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

export interface ProcessVideoEntryResult {
    fileUuid: string;
    entryUuid: string;
    videoModule: string;
    videoIdentifier: string;
    videoPlaylist: string;
}

export interface VideoIdentifierData {
    [videoIdentifier: string]: string;
}

export interface VideoModuleData {
    [videoModule: string]: VideoIdentifierData;
}

export interface PlaylistData {
    name: string;
    modules: VideoModuleData;
}

export interface VideoPlaylistData {
    [uuid: string]: PlaylistData;
}

export interface DiscordQueueData {
    module: string;
    video: string;
    videoFolder: string;
    entryPath: string;
}

export interface DiscordQueueResult {
    module: string;
    video: string;
    videoFolder: string;
    entryPath: string;
}

export interface DiscordQueue {
    identifier: string;
    data: DiscordQueueData;
}

export function ZIP_DECODING_ADM() {
    return 'zip.decoding.adm-zip';
}

export function ZIP_DECODING_YAUZL() {
    return 'zip.decoding.yazul';
}