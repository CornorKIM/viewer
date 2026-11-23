import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIB = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(LIB, '../..');
export const SUT_DIR = path.join(REPO, 'sf-daily');
export const TLS_DIR = path.join(LIB, 'tls');
