import { CourseDatabase, DatabaseInterface } from '../interfaces';
import * as fs from 'fs';

class Database {
    private database: DatabaseInterface = {};
    private initialized: boolean = false;

    public async init(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            if (fs.existsSync('database.json')) {
                this.database = JSON.parse(fs.readFileSync('database.json', 'utf-8'));
            } else {
                this.write(true);
            }
            this.initialized = true;
        } catch (error: any) {
            throw new Error(`Error reading the database: ${error.message}`);
        }
    }

    public async read(): Promise<void> {
        this.database = JSON.parse(fs.readFileSync('database.json', 'utf-8'));
        this.initialized = true;
    }

    public async write(force: boolean = false): Promise<void> {
        fs.writeFileSync('database.json', JSON.stringify(force ? this.database : this.data(), null, 2), 'utf-8');
    }

    public data(): DatabaseInterface {
        if (!this.initialized) {
            throw new Error('The database has not been initialized.');
        }
        return this.database;
    }

    public count(): number {
        return Object.keys(this.data()).length;
    }

    public set(uuid: string, data: CourseDatabase): void {
        this.data()[uuid] = data;
    }

    /**
     * Retrieves all courses from the database.
     *
     * @param name - If true, returns the names of the courses; otherwise, returns the uuids.
     * @returns An array of course names or uuids, depending on the value of `name`.
     */
    public getAll(name: boolean = false): string[] {
        return name ? Object.values(this.data()).map((course) => course.name) : Object.keys(this.data());
    }
}

export default new Database();
