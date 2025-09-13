import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function packageRoot(): string {
  // database/src -> database
  const here = fileURLToPath(new URL('.', import.meta.url));
  return path.resolve(here, '..');
}

export function resolvePackagePath(...segments: string[]): string {
  return path.join(packageRoot(), ...segments);
}

