import { ZIP_DECODING_ADM, ZIP_DECODING_YAUZL } from '../types/interfaces';
import { ZipFileEntry } from '../types/interfaces';
import AdmZip from 'adm-zip';
import * as yauzl from 'yauzl';

export class ZipArchive {
    private writeFileBufferReading: boolean = true;
    private zipDecodingType: string = ZIP_DECODING_YAUZL();

    private readNamesInclusionHandlers: ((entry: string) => boolean)[] = [];

    public addReadNamesInclusionHandler(handler: (entry: string) => boolean): void {
        this.readNamesInclusionHandlers.push(handler);
    }

    public setWriteFileBufferReading(writeFileBufferReading: boolean): void {
        this.writeFileBufferReading = writeFileBufferReading;
    }

    public setZipDecodingType(zipDecodingType: string): void {
        this.zipDecodingType = zipDecodingType;
    }

    public handleReadNamesInclusion(entry: string): boolean {
        return this.readNamesInclusionHandlers.length === 0 || this.readNamesInclusionHandlers.some((handler) => handler(entry));
    }

    public async readZipFileEntries(fileBuffer: Buffer): Promise<ZipFileEntry[]> {
        return new Promise<ZipFileEntry[]>((resolve, reject) => {
            if (this.zipDecodingType === ZIP_DECODING_YAUZL()) {
                this.yauzlFromBuffer(fileBuffer)
                    .then((entries) => {
                        resolve(entries);
                    })
                    .catch((error) => {
                        throw new Error(error);
                    });
            } else if (this.zipDecodingType === ZIP_DECODING_ADM()) {
                this.admZipFromBuffer(fileBuffer)
                    .then((entries) => {
                        resolve(entries);
                    })
                    .catch((error) => {
                        throw new Error(error);
                    });
            } else {
                throw new Error('Unable to find zip decryption type');
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
                        if (this.handleReadNamesInclusion(entry.entryName)) {
                            const writeBuffer = async () => {
                                return new Promise<Buffer>((resolveWrite, rejectWrite) => {
                                    entry.getDataAsync((entryBuffer: Buffer, error: string) => {
                                        if (error) {
                                            throw new Error(`Error opening read stream for entry ${entry.entryName}: ${error}`);
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
                                        throw new Error(error);
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
                    .catch((error) => {
                        throw new Error(error);
                    });

                entryPromises.length = 0;
            } catch (error) {
                throw new Error(`Error during ZIP reading: ${error}`);
            } finally {
                entries.length = 0;
            }
        });
    }

    private async yauzlFromBuffer(fileBuffer: Buffer): Promise<ZipFileEntry[]> {
        return new Promise<ZipFileEntry[]>((resolve, reject) => {
            yauzl.fromBuffer(fileBuffer, { lazyEntries: true }, async (error, file) => {
                if (error) {
                    throw new Error(`Error opening ZIP: ${error}`);
                }

                const entryPromises: Promise<ZipFileEntry>[] = [];

                file.readEntry();
                file.on('entry', async (entry: yauzl.Entry) => {
                    if (this.handleReadNamesInclusion(entry.fileName)) {
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
                        throw new Error(`Error processing entries: ${err}`);
                    } finally {
                        file.close();

                        entryPromises.length = 0;
                    }
                });

                file.on('error', (error) => {
                    throw new Error(`Error during ZIP reading: ${error}`);
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
                            throw new Error(`Error opening read stream for entry ${entry.fileName}: ${error}`);
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
                            throw new Error(`Error reading stream for entry ${entry.fileName}: ${error}`);
                        });
                    });
                });

            if (this.writeFileBufferReading) {
                writeBuffer()
                    .then((buffer) => {
                        resolve(buffer);
                    })
                    .catch((error) => {
                        throw new Error(error);
                    });
            } else {
                resolve(writeBuffer);
            }
        });
    }
}
