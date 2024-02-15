import { ContentUuids, CourseDatabase, CourseModules, DatabaseType } from '../types/interfaces';
import * as fs from 'fs';

class Database {
    private database: DatabaseType = {};
    private baseDatabase: DatabaseType = {};
    private contentUuids: ContentUuids = {};
    private initialized: boolean = false;

    public async init(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            await this.read();
        } catch (error: any) {
            throw new Error(`Error reading the database: ${error.message}`);
        }
    }

    public async read(): Promise<void> {
        if (fs.existsSync('database.json')) {
            this.database = JSON.parse(fs.readFileSync('database.json', 'utf-8'));
        } else {
            this.write(true);
        }

        if (fs.existsSync('data/base-database.json')) {
            this.baseDatabase = JSON.parse(fs.readFileSync('data/base-database.json', 'utf-8'));
        } else {
            throw new Error('The base database does not exist.');
        }

        if (fs.existsSync('data/content-uuids.json')) {
            this.contentUuids = JSON.parse(fs.readFileSync('data/content-uuids.json', 'utf-8'));
        } else {
            throw new Error('The content uuids file does not exist.');
        }
        this.initialized = true;
    }

    public async write(force: boolean = false): Promise<void> {
        fs.writeFileSync('database.json', JSON.stringify(force ? this.database : this.data(), null, 2), 'utf-8');
    }

    public data(base: boolean = false): DatabaseType {
        if (!this.initialized) {
            throw new Error('The database has not been initialized.');
        }
        return base ? this.baseDatabase : this.database;
    }

    public count(base: boolean = false): number {
        return Object.keys(this.data(base)).length;
    }

    public set(uuid: string, data: CourseDatabase): void {
        this.data()[uuid] = data;
    }

    public get(uuid: string, base: boolean = false): CourseDatabase {
        return this.data(base)[uuid];
    }

    public readAndSetModules(uuid: string, modules: CourseModules): void {
        this.set(uuid, { ...this.get(uuid, true), modules });
    }

    public getContents(): ContentUuids {
        if (!this.initialized) {
            throw new Error('The database has not been initialized.');
        }

        return this.contentUuids;
    }

    /**
     * Retrieves all courses from the database.
     *
     * @param name - If true, returns the names of the courses; otherwise, returns the uuids.
     * @returns An array of course names or uuids, depending on the value of `name`.
     */
    public getAll(name: boolean = false, base: boolean = false): string[] {
        return name ? Object.values(this.data(base)).map((course) => course.name) : Object.keys(this.data(base));
    }
}

export default new Database();
