import * as fs from 'fs';
import Knex from 'knex';
import { DatabaseInterface } from '../manager/interfaces';

const knexConfig = {
    client: 'pg',
    connection: {
        host: 'ep-aged-voice-a4unf3ws-pooler.us-east-1.postgres.vercel-storage.com',
        user: 'default',
        password: '3AyEUHPBCh2e',
        database: 'verceldb',
        ssl: { rejectUnauthorized: false }
    },
    pool: { min: 0, max: 1 }
};
const typeCompare = true;
const knexInstance = Knex(knexConfig);

const compareDatabase = async (fileDatabase: DatabaseInterface, knexInstance: Knex.Knex<any, unknown[]>) => {
    for (const [id, data] of Object.entries(fileDatabase)) {
        const { name, modules } = data;

        try {
            const courseRow = await knexInstance('courses').where('id', id).first();

            if (!courseRow) {
                console.error(`Data for course with id ${id} not found in 'courses' table.`);
            } else {
                if (courseRow.name !== name) {
                    console.error(`Mismatch in 'name' for course with id ${id}. Expected: ${name}, Actual: ${courseRow.name}`);
                }
            }

            for (const [module, moduleData] of Object.entries(modules)) {
                const moduleRow = await knexInstance('modules').where({ course_id: id, module }).first();

                if (!moduleRow) {
                    console.error(`Data for module with course_id ${id} and module ${module} not found in 'modules' table.`);
                }

                for (const [video, playlist] of Object.entries(moduleData)) {
                    const videoRow = await knexInstance('videos').where({ course_id: id, module, video }).first();

                    if (!videoRow) {
                        console.error(
                            `Data for video with course_id ${id}, module ${module}, and video ${video} not found in 'videos' table.`
                        );
                    } else {
                        if (videoRow.module !== module) {
                            console.error(
                                `Mismatch in 'module' for video with course_id ${id}, module ${module}, and video ${video}. Expected: ${module}, Actual: ${videoRow.module}`
                            );
                        }
                        if (videoRow.video !== video) {
                            console.error(
                                `Mismatch in 'video' for video with course_id ${id}, module ${module}, and video ${video}. Expected: ${video}, Actual: ${videoRow.video}`
                            );
                        }
                        if (videoRow.playlist !== playlist) {
                            console.error(
                                `Mismatch in 'playlist' for video with course_id ${id}, module ${module}, and video ${video}.`
                            );
                        }
                    }
                }
            }
        } catch (error: any) {
            console.error(`Error querying database: ${error.message}`);
        }
    }
};

async function createTables() {
    const coursesTableExists = await knexInstance.schema.hasTable('courses');
    if (!coursesTableExists) {
        await knexInstance.schema.createTable('courses', (table) => {
            table.text('id').primary();
            table.text('name');
        });
        await knexInstance.schema.raw('CREATE INDEX IF NOT EXISTS idx_courses_name ON courses (name)');
    }

    const modulesTableExists = await knexInstance.schema.hasTable('modules');
    if (!modulesTableExists) {
        await knexInstance.schema.createTable('modules', (table) => {
            table.text('course_id');
            table.text('module');
            table.primary(['course_id', 'module']);
            table.foreign('course_id').references('courses.id');
        });
    }

    const videosTableExists = await knexInstance.schema.hasTable('videos');
    if (!videosTableExists) {
        await knexInstance.schema.createTable('videos', (table) => {
            table.text('course_id');
            table.text('module');
            table.text('video');
            table.text('playlist');
            table.primary(['course_id', 'module', 'video']);
            table.foreign('course_id').references('courses.id');
            table.foreign(['course_id', 'module']).references(['modules.course_id', 'modules.module']);
        });
    }
}

async function migrateData() {
    const database: DatabaseInterface = JSON.parse(fs.readFileSync('database.json', 'utf8'));

    try {
        console.log('Iniciando migração...');

        if (!typeCompare) {
            console.log('Criando tabelas...');
            await createTables();
            console.log('Tabelas criadas com sucesso!');

            console.log('Inserindo dados...');

            let courseQueries: { message: string; query: Promise<any> }[] = [];
            let moduleQueries: { message: string; query: Promise<any> }[] = [];
            let videoQueries: { message: string; query: Promise<any> }[] = [];

            const pushQuery = (message: string, queries: { message: string; query: Promise<any> }[], query: any) => {
                queries.push({ message, query });
            };

            for (const [id, data] of Object.entries(database)) {
                pushQuery(
                    `Inseriando curso: ${data.name}`,
                    courseQueries,
                    knexInstance('courses').insert({ id, name: data.name })
                );

                for (const [module, moduleData] of Object.entries(data.modules)) {
                    pushQuery(
                        `Inseriando modulo: ${module} de ${data.name}`,
                        moduleQueries,
                        knexInstance('modules').insert({ course_id: id, module })
                    );

                    for (const [video, playlist] of Object.entries(moduleData)) {
                        pushQuery(
                            `Inserindo vídeo: ${video} no módulo ${module} do curso ${data.name}`,
                            videoQueries,
                            knexInstance('videos').insert({ course_id: id, module, video, playlist })
                        );
                    }
                }
            }
            let queries = [...courseQueries, ...moduleQueries, ...videoQueries];
            let queriesCount = queries.length;
            let queriesDone = 0;

            for (const { message, query } of queries) {
                console.log(`[${queriesDone.toLocaleString('pt-BR')}/${queriesCount.toLocaleString('pt-BR')}] ${message}`);
                queriesDone++;
                await query;
            }
        } else {
            console.log('Comparando dados...');
            await compareDatabase(database, knexInstance);
        }

        console.log('Migração concluída com sucesso!');
    } catch (error) {
        console.error('Erro durante a migração:', error);
    } finally {
        await knexInstance.destroy();
        console.log('Conexão com o banco de dados encerrada.');
    }
}

migrateData();
