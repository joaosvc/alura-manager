import * as fs from 'fs';
import { DatabaseInterface } from '../manager/interfaces';

const database: DatabaseInterface = JSON.parse(fs.readFileSync('database.json', 'utf-8'));
const fixerData: { old: string; new: string }[] = JSON.parse(fs.readFileSync('fixer-data.json', 'utf-8'));

let fixing: { [old: string]: string } = {};
let newDatabase: DatabaseInterface = {};

for (let fixer of Object.values(fixerData)) {
    fixing[fixer.old] = fixer.new;
}

for (let [uuid, data] of Object.entries(database)) {
    const { name, modules } = data;

    let newName = name;

    if (fixing[name]) {
        newName = fixing[name];

        console.log(`Fixing ${name} to ${newName}`);

        delete fixing[name];
    }

    newDatabase[uuid] = {
        name: newName,
        modules: modules
    };
}

fs.writeFileSync('new-database.json', JSON.stringify(newDatabase, null, 2));
