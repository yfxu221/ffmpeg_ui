import { packager } from '@electron/packager';
import { mkdir, readdir, copyFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const appVersion = require('../package.json').version;
const { resolveBinaries, capture } = require('../dist-electron/electron/engine.js');
const binaries = await resolveBinaries({ ffmpegPath: process.env.FRAMEFORGE_FFMPEG || '', ffprobePath: process.env.FRAMEFORGE_FFPROBE || '', outputDir: '' });
const electronVersion = require('electron/package.json').version;
const cachedZips = path.resolve('.cache/electron');
let electronZipDir;
try {
  for (const name of await readdir(cachedZips)) {
    const directory = path.join(cachedZips, name);
    if ((await readdir(directory)).includes(`electron-v${electronVersion}-win32-x64.zip`)) { electronZipDir = directory; break; }
  }
} catch { /* Packager will download Electron if no cached ZIP exists. */ }
const binDir = path.resolve('.cache/package/bin');
await mkdir(binDir, { recursive: true });
await mkdir(path.resolve('.cache/packager'), { recursive: true });
await mkdir(path.resolve('assets/licenses'), { recursive: true });
for (const name of ['react', 'react-dom', 'lucide-react']) {
  await copyFile(path.resolve(`node_modules/${name}/LICENSE`), path.resolve(`assets/licenses/${name}.txt`));
}
for (const executable of Object.values(binaries)) {
  await copyFile(executable, path.join(binDir, path.basename(executable)));
  for (const name of await readdir(path.dirname(executable))) {
    if (/^(avcodec|avformat|avutil|avfilter|avdevice|swscale|swresample|postproc|lib.+)-?[\w.-]*\.dll$/i.test(name)) await copyFile(path.join(path.dirname(executable), name), path.join(binDir, name));
  }
}
const version = await capture(path.join(binDir, 'ffmpeg.exe'), ['-version']);
await capture(path.join(binDir, 'ffprobe.exe'), ['-version']);
const revision = version.match(/-g([0-9a-f]{7,40})/i)?.[1];
await writeFile(path.join(binDir, 'BUILD-INFO.txt'), `${version}\nFFmpeg: https://ffmpeg.org/\nSource revision: ${revision ? `https://github.com/FFmpeg/FFmpeg/tree/${revision}` : 'See the binary provider for corresponding source.'}\nBuild configuration and enabled libraries are shown above.\nSee THIRD-PARTY-NOTICES.md in the app resources for the initial local build.\n`);
const destinations = await packager({
  dir: '.', out: `release/v${appVersion}`, name: 'FrameForge', platform: 'win32', arch: 'x64',
  overwrite: true, asar: true, prune: true, icon: 'assets/icon.ico',
  electronZipDir,
  tmpdir: path.resolve('.cache/packager'),
  extraResource: [binDir],
  ignore: [/^\/(?:\.git|\.cache|\.test-output|release|node_modules|src|electron|shared|scripts|tests)(?:\/|$)/, /^\/(?:tsconfig.*|vite\.config.*|package-lock\.json|启动.*)$/],
  win32metadata: { CompanyName: 'FrameForge', FileDescription: 'FrameForge 媒体工作台', ProductName: 'FrameForge', InternalName: 'FrameForge' },
});
for (const destination of destinations) {
  await writeFile(path.resolve('release/latest.txt'), path.relative(process.cwd(), path.join(destination, 'FrameForge.exe')), 'utf8');
  console.log(`Portable app ready: ${destination}`);
}
