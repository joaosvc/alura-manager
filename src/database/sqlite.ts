import * as fs from 'fs';
import * as sqlite3 from 'sqlite3';
import { DatabaseInterface } from '../manager/interfaces';

const databaseFilePath = './database.json';
const sqliteFilePath = './database.db';

const compareDatabase = async (fileDatabase: DatabaseInterface, sqlDatabase: sqlite3.Database) => {
    console.log('Comparing databases...');

    for (const [id, data] of Object.entries(fileDatabase)) {
        const { name, modules } = data;

        sqlDatabase.get('SELECT * FROM courses WHERE id = ?', [id], (error, row: any) => {
            if (error) {
                console.error(`Error querying 'courses' table: ${error.message}`);
            } else {
                if (!row) {
                    console.error(`Data for course with id ${id} not found in 'courses' table.`);
                } else {
                    if (row.name !== name) {
                        console.error(`Mismatch in 'name' for course with id ${id}. Expected: ${name}, Actual: ${row.name}`);
                    }
                }
            }
        });

        for (const [module, moduleData] of Object.entries(modules)) {
            sqlDatabase.get('SELECT * FROM modules WHERE course_id = ? AND module = ?', [id, module], (error, row: any) => {
                if (error) {
                    console.error(`Error querying 'modules' table: ${error.message}`);
                } else {
                    if (!row) {
                        console.error(`Data for module with course_id ${id} and module ${module} not found in 'modules' table.`);
                    }
                }
            });

            for (const [video, playlist] of Object.entries(moduleData)) {
                sqlDatabase.get(
                    'SELECT * FROM videos WHERE course_id = ? AND module = ? AND video = ?',
                    [id, module, video],
                    (error, row: any) => {
                        if (error) {
                            console.error(`Error querying 'videos' table: ${error.message}`);
                        } else {
                            if (!row) {
                                console.error(
                                    `Data for video with course_id ${id}, module ${module}, and video ${video} not found in 'videos' table.`
                                );
                            } else {
                                if (row.module !== module) {
                                    console.error(
                                        `Mismatch in 'module' for video with course_id ${id}, module ${module}, and video ${video}. Expected: ${module}, Actual: ${row.module}`
                                    );
                                }
                                if (row.video !== video) {
                                    console.error(
                                        `Mismatch in 'video' for video with course_id ${id}, module ${module}, and video ${video}. Expected: ${video}, Actual: ${row.video}`
                                    );
                                }
                                if (row.playlist !== playlist) {
                                    console.error(
                                        `Mismatch in 'playlist' for video with course_id ${id}, module ${module}, and video ${video}.`
                                    );
                                }
                            }
                        }
                    }
                );
            }
        }
    }
};

const readDatabaseFile = (filePath: string): DatabaseInterface => {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(fileContent);
    } catch (error: any) {
        throw new Error(`Error reading database file: ${error.message}`);
    }
};

const createTable = (db: sqlite3.Database, tableName: string, createStatement: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        db.run(createStatement, (error) => {
            if (error) {
                reject(`Error creating ${tableName} table: ${error.message}`);
            } else {
                console.log(`${tableName} table created successfully.`);
                resolve();
            }
        });
    });
};

const createIndex = (db: sqlite3.Database, indexName: string, createStatement: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        db.run(createStatement, (error) => {
            if (error) {
                reject(`Error creating index ${indexName}: ${error.message}`);
            } else {
                console.log(`Index ${indexName} created successfully.`);
                resolve();
            }
        });
    });
};

const insertData = (db: sqlite3.Database, statement: string, values: any[]): Promise<void> => {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(statement);

        stmt.run(...values, (error: any) => {
            if (error) {
                reject(`Error inserting data: ${error.message}`);
            } else {
                stmt.finalize();
                resolve();
            }
        });
    });
};

const initializeDatabase = async () => {
    if (fs.existsSync(sqliteFilePath)) {
        await fs.promises.unlink(sqliteFilePath);
    }

    const database: DatabaseInterface = readDatabaseFile(databaseFilePath);
    const sqlDatabase = new sqlite3.Database(sqliteFilePath);

    try {
        await createTable(
            sqlDatabase,
            'courses',
            `
            CREATE TABLE IF NOT EXISTS courses (
                id TEXT PRIMARY KEY,
                name TEXT
            );
        `
        );
        await createIndex(sqlDatabase, 'idx_courses_name', 'CREATE INDEX IF NOT EXISTS idx_courses_name ON courses (name);');

        await createTable(
            sqlDatabase,
            'modules',
            `
            CREATE TABLE IF NOT EXISTS modules (
                course_id TEXT,
                module TEXT,
                PRIMARY KEY (course_id, module),
                FOREIGN KEY (course_id) REFERENCES courses(id)
            );
        `
        );

        await createTable(
            sqlDatabase,
            'videos',
            `
            CREATE TABLE IF NOT EXISTS videos (
                course_id TEXT,
                module TEXT,
                video TEXT,
                playlist TEXT,
                PRIMARY KEY (course_id, module, video),
                FOREIGN KEY (course_id) REFERENCES courses(id),
                FOREIGN KEY (course_id, module) REFERENCES modules(course_id, module)
            );
        `
        );

        sqlDatabase.run('BEGIN TRANSACTION;');

        for (const [id, data] of Object.entries(database)) {
            const { name, modules } = data;

            await insertData(sqlDatabase, 'INSERT INTO courses (id, name) VALUES (?, ?);', [id, name]);

            for (const [module, moduleData] of Object.entries(modules)) {
                await insertData(sqlDatabase, 'INSERT INTO modules (course_id, module) VALUES (?, ?);', [id, module]);

                for (const [video, playlist] of Object.entries(moduleData)) {
                    await insertData(
                        sqlDatabase,
                        'INSERT INTO videos (course_id, module, video, playlist) VALUES (?, ?, ?, ?);',
                        [id, module, video, playlist]
                    );
                }
            }
        }

        sqlDatabase.run('COMMIT;');

        sqlDatabase.run('VACUUM;', async (vacuumError) => {
            if (vacuumError) {
                console.error(`Error executing VACUUM: ${vacuumError.message}`);
            } else {
                console.log('VACUUM executed successfully.');

                await compareDatabase(database, sqlDatabase);
            }
        });
    } catch (error: any) {
        console.error(error);
    } finally {
        sqlDatabase.close((error) => {
            if (error) {
                console.error(`Error closing the database: ${error.message}`);
            } else {
                console.log(`Database closed successfully.`);
            }
        });
    }
};

initializeDatabase();
