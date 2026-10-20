import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';
const packaged = process.argv.includes('--packaged');
const env = { ...process.env, FRAMEFORGE_USER_DATA: path.resolve(packaged ? '.test-output/profile-portable' : '.test-output/profile') };
delete env.ELECTRON_RUN_AS_NODE;
if (packaged) {
  // Prove the app does not depend on Node, Python or FFmpeg from the user's PATH.
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.Path = `${process.env.SystemRoot || 'C:\\Windows'}\\System32`;
}
const child = spawn(packaged ? path.resolve('release/FrameForge-win32-x64/FrameForge.exe') : electron, packaged ? ['--smoke'] : ['.', '--smoke'], { stdio: 'inherit', env, windowsHide: true });
child.on('error', error => { console.error('Desktop runtime could not start:', error); process.exit(1); });
child.on('exit', code => process.exit(code ?? 1));
