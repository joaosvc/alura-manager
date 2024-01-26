import { existsSync, promises as fs } from "fs";
import { PlaylistData, VideoPlaylistData } from "../interfaces";
import { promises as fsPromises } from 'fs';

class Database {
    private database: VideoPlaylistData = {};
    private initialized: boolean = false;

    public async init(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            if (existsSync('database.json')) {
                this.database = JSON.parse(await fs.readFile('database.json', 'utf-8'));
            } else {
                this.writeData(true);
            }
            this.initialized = true;
        } catch (error: any) {
            throw new Error(`Error reading the database: ${error.message}`);
        }
    }

    public getData(): VideoPlaylistData {
        if (!this.initialized) {
            throw new Error('The database has not been initialized.');
        }
        return this.database;
    }

    public data(): VideoPlaylistData {
        return this.getData();
    }

    public getDataCount(): number {
        return Object.keys(this.data()).length;
    }

    public async readData(): Promise<void> {
        this.database = JSON.parse(await fsPromises.readFile('database.json', 'utf-8'));
        this.initialized = true;
    }

    public async writeData(force: boolean = false): Promise<void> {
        await fsPromises.writeFile('database.json', JSON.stringify(force ? this.database : this.data(), null, 2), 'utf-8');
    }

    public set(uuid: string, data: PlaylistData): void {
        this.data()[uuid] = data;
    }

    public existsPlaylistId(name: string): boolean {
        return !!this.data()[name];
    }

    public existsModule(name: string, module: string): boolean {
        if (!this.existsPlaylistId(name)) {
            throw new Error(`Playlist ${name} does not exist.`);
        }
        return !!this.data()[name].modules[module];
    }

    public existsPlaylist(name: string, module: string, video: string): boolean {
        if (!this.existsModule(name, module)) {
            throw new Error(`Module ${module} does not exist in playlist ${name}.`);
        }
        return !!this.data()[name].modules[module][video];
    }

    public getPlaylist(name: string, module: string, video: string): string {
        if (!this.existsPlaylist(name, module, video)) {
            throw new Error(`Video ${video} does not exist in module ${module} of playlist ${name}.`);
        }
        return this.data()[name].modules[module][video];
    }

    public getAllPlaylistNames(): string[] {
        return Object.values(this.data()).map((playlist) => playlist.name);
    }

    public async eachPlaylist(callback: (playlist: PlaylistData, uuid: string) => void): Promise<void> {
        await Promise.all(Object.keys(this.data()).map(async (uuid) => {
            callback(this.data()[uuid], uuid);
        }));
    }
}

export default new Database();