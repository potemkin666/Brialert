import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const targets = [
  {
    label: 'sources catalog',
    relativePath: 'data/sources.json',
    validate(parsed) {
      if (!Array.isArray(parsed) && !Array.isArray(parsed?.sources)) {
        throw new Error('expected a top-level array or an object with a sources array');
      }
    }
  },
  {
    label: 'geo lookup',
    relativePath: 'data/geo-lookup.json',
    validate(parsed) {
      if (!Array.isArray(parsed)) {
        throw new Error('expected a top-level array');
      }
    }
  }
];

function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : text;
}

async function validateTarget(target) {
  const filePath = path.join(repoRoot, target.relativePath);
  const raw = stripBom(await fs.readFile(filePath, 'utf8'));

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${target.relativePath}: invalid JSON (${message})`);
  }

  try {
    target.validate(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${target.relativePath}: invalid structure (${message})`);
  }

  return `${target.label} OK`;
}

async function main() {
  for (const target of targets) {
    const result = await validateTarget(target);
    console.log(result);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
