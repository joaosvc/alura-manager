import * as fs from 'fs';
import { DatabaseInterface } from '../manager/interfaces';
import { ExtendedClient } from '../structs/types/ExtendedClient';

async function uploadPlaylist(client: ExtendedClient, playlist: string, name: string, currentAttempt: number = 0): Promise<string> {
    const { status, result } = await client.uploadDiscordFile(playlist, name, currentAttempt, true, false);

    if (status === 'retry') {
        await client.delay(2000);

        return await uploadPlaylist(client, playlist, name, ++currentAttempt);
    }

    return result!;
}

async function upload() {
    const database: DatabaseInterface = JSON.parse(fs.readFileSync('database.json', 'utf-8'));
    const client = new ExtendedClient();

    let uploadQueries: { message: string; query: Promise<void> }[] = [];

    const pushUploadQuery = (message: string, query: Promise<void>) => {
        uploadQueries.push({ message, query });
    };

    for (let [uuid, data] of Object.entries(database)) {
        for (let [module, videos] of Object.entries(data.modules)) {
            for (let [video, playlist] of Object.entries(videos)) {
                pushUploadQuery(
                    `Enviando: ${data.name} - ${module} - ${video}`,
                    new Promise(async (resolve) => {
                        database[uuid].modules[module][video] = await uploadPlaylist(client, playlist, `${uuid}${module}${video}`);

                        resolve();
                    })
                );
            }
        }
    }

    let completed = 0;

    const logAndAwait = async (chunk: { message: string; query: Promise<void> }[]) => {
        for (const { message, query } of chunk) {
            console.log(`[${(completed++).toLocaleString('pt-BR')}/${uploadQueries.length.toLocaleString('pt-BR')}] ${message}`);
            await query;
        }
    };

    const chunks = client.chunkArray(uploadQueries, 3);

    await Promise.all(chunks.map(logAndAwait));

    fs.writeFileSync('u-database.json', JSON.stringify(database, null, 2));
}

upload();
