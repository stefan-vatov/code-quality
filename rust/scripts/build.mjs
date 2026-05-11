import { mkdir, cp } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await cp('configs', 'dist/configs', { recursive: true });
