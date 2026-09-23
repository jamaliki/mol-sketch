// Build what the Python package ships: the headless core (molsketch/_core.js) and the app itself (molsketch/app/,
// served by `molsketch serve`). Run after changing the app: node scripts/build-python.mjs
import { execSync } from 'child_process'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)); const app = path.join(here, '..'); const pkg = path.join(app, '..', 'python', 'molsketch');
execSync('npm run build', { cwd: app, stdio: 'inherit' });
execSync('node scripts/build-core.mjs', { cwd: app, stdio: 'inherit' });
fs.rmSync(path.join(pkg, 'app'), { recursive: true, force: true });
fs.cpSync(path.join(app, 'dist'), path.join(pkg, 'app'), { recursive: true, filter: s => !/6GZQ\.cif$/.test(s) });
console.log('app → python/molsketch/app');
