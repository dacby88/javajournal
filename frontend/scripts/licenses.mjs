import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const notices = new Map();

async function packages(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = path.join(directory, entry.name);
    if (entry.name.startsWith('@')) {
      await packages(folder);
      continue;
    }
    const manifest = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
    const key = `${manifest.name}@${manifest.version}`;
    if (!notices.has(key)) {
      const entries = await readdir(folder, { withFileTypes: true });
      const texts = [];
      for (const file of entries) {
        if (file.isFile() && /^(license|licence|copying|notice)([._-]|$)/i.test(file.name)) {
          texts.push(await readFile(path.join(folder, file.name), 'utf8'));
        }
      }
      if (texts.length) notices.set(key, `${key}\n\n${texts.join('\n\n')}`);
    }
    try {
      await packages(path.join(folder, 'node_modules'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

await packages('node_modules');
const own = await readFile('THIRD_PARTY_NOTICES', 'utf8');
const dependencies = [...notices.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text);
await writeFile('dist/THIRD_PARTY_LICENSES.txt', `${own}\n\nInstalled build dependencies (some are build-only):\n\n${dependencies.join('\n\n---\n\n')}`);
console.log(`Included license notices for ${notices.size} dependency packages.`);
