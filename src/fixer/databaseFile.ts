import * as fs from 'fs';

fs.writeFileSync('database.ts', `const database = ${fs.readFileSync('database.l.json', 'utf-8')}`, 'utf-8');
