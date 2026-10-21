import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';
import { createRequire } from 'node:module';
const appVersion = createRequire(import.meta.url)('../package.json').version;
const packaged = process.argv.includes('--packaged');
const env = { ...process.env, FRAMEFORGE_USER_DATA: path.resolve(packaged ? '.test-output/profile-portable' : '.test-output/profile') };
delete env.ELECTRON_RUN_AS_NODE;
if (packaged) {
  // Prove the app does not depend on Node, Python or FFmpeg from the user's PATH.
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.Path = `${process.env.SystemRoot || 'C:\\Windows'}\\System32`;
}
const executable = packaged ? path.resolve(`release/v${appVersion}/FrameForge-win32-x64/FrameForge.exe`) : electron;
const stages = process.argv.includes('--gif-only') ? [true] : [false, true];
for (const gif of stages) {
  const stageEnv = { ...env, FRAMEFORGE_USER_DATA: path.resolve(`.test-output/profile-${packaged ? 'portable-' : ''}${gif ? 'gif' : 'regular'}`) };
  const args = [...(packaged ? [] : ['.']), '--smoke', ...(gif ? ['--smoke-gif'] : [])];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio:'inherit', env:stageEnv, windowsHide:true });
    child.on('error', reject); child.on('exit', code => resolve(code ?? 1));
  }).catch(error => { console.error('Desktop runtime could not start:',error); return 1; });
  if (code !== 0) process.exit(Number(code));
}
