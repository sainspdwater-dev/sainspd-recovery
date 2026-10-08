import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const html = await readFile('index_dashboard.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(value => value.trim());
for (const source of scripts) new Function(source);
const manifestSource = await readFile('assets/kml-kolam-manifest.js', 'utf8');
new Function(manifestSource);

async function countKml(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) count += entry.isDirectory() ? await countKml(path.join(directory, entry.name)) : Number(entry.name.toLowerCase().endsWith('.kml'));
  return count;
}

const fileCount = await countKml('assets/kml-kolam');
const manifestCount = (manifestSource.match(/path:\s*'/g) || []).length;
if (fileCount !== manifestCount) throw new Error(`KML manifest mismatch: ${fileCount} files, ${manifestCount} manifest entries`);
console.log(`Checks passed: ${scripts.length} inline script, ${fileCount} KML files.`);

