import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist/main', { recursive: true });
await copyFile('src/main/preload.cjs', 'dist/main/preload.cjs');
