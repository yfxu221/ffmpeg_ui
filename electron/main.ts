import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, Menu } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { MediaEngine, checkEngine, resolveBinaries, inspectMedia, buildArguments, displayCommand, validateOptions, stopCaptures } from './engine';
import type { ExportOptions, JobProgress, Settings } from '../shared/types';
import { PreviewManager } from './previews';

if (process.env.FRAMEFORGE_USER_DATA) app.setPath('userData', path.resolve(process.env.FRAMEFORGE_USER_DATA));
app.setAppUserModelId('studio.frameforge.desktop');
protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const engine = new MediaEngine();
const mediaFiles = new Map<string, string>();
const approvedFiles = new Set<string>();
const completedFiles = new Set<string>();
let window: BrowserWindow;
let settings: Settings = { ffmpegPath: '', ffprobePath: '', outputDir: '' };
let previews: PreviewManager;
let closing = false;
let quitCleanupStarted = false;
const bundledDir = () => path.join(process.resourcesPath, 'bin');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const fileUrl = (input: string, fresh = false) => {
  if (!fresh) for (const [id, value] of mediaFiles) if (value === input) return `media://asset/${id}`;
  const id = randomUUID(); mediaFiles.set(id, input); return `media://asset/${id}`;
};
function authorizedFile(input: string) {
  if (typeof input !== 'string' || (!approvedFiles.has(input) && !completedFiles.has(input))) throw new Error('请先导入文件。');
}
function handle(channel: string, callback: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效的窗口请求。');
    return callback(...args);
  });
}

async function createWindow() {
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1320, height: 900, minWidth: 1080, minHeight: 760,
    frame: false, backgroundColor: '#f7f8fa', show: false,
    icon: path.join(__dirname, '../../assets/icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !process.argv.includes('--smoke') },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.once('ready-to-show', () => { if (!process.argv.includes('--smoke')) window.show(); });
  window.on('close', event => {
    if (!engine.busy || closing) return;
    event.preventDefault();
    void (async () => {
      const result = await dialog.showMessageBox(window, { type: 'question', message: '正在处理文件，取消任务并退出？', buttons: ['继续处理', '取消并退出'], defaultId: 0, cancelId: 0, noLink: true });
      if (result.response === 1) { closing = true; await engine.cancel(); window.close(); }
    })();
  });
  const developmentUrl = process.env.FRAMEFORGE_DEV_URL;
  if (developmentUrl) {
    if (developmentUrl !== 'http://127.0.0.1:5173') throw new Error('无效的开发服务器地址。');
    await window.loadURL(developmentUrl);
  } else await window.loadFile(path.join(__dirname, '../../dist/index.html'));
}

async function initialize() {
  previews = new PreviewManager(app.getPath('temp'));
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  try {
    const saved = JSON.parse(await fs.readFile(settingsFile(), 'utf8'));
    for (const key of ['ffmpegPath', 'ffprobePath', 'outputDir'] as const) if (typeof saved[key] === 'string') settings[key] = saved[key];
  } catch { /* Fresh profile or invalid settings: use defaults. */ }
  protocol.handle('media', request => {
    const url = new URL(request.url);
    const input = url.hostname === 'asset' ? mediaFiles.get(url.pathname.slice(1)) : undefined;
    if (!input) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(input).toString(), { headers: request.headers });
  });
  handle('settings:get', () => settings);
  handle('settings:save', async (incoming: Settings) => {
    if (engine.busy) throw new Error('请等待当前任务结束后再修改设置。');
    if (!incoming || ['ffmpegPath', 'ffprobePath', 'outputDir'].some(key => typeof incoming[key as keyof Settings] !== 'string')) throw new Error('设置无效。');
    for (const value of Object.values(incoming)) if (value && !path.isAbsolute(value)) throw new Error('请选择绝对路径。');
    const next = { ffmpegPath: incoming.ffmpegPath, ffprobePath: incoming.ffprobePath, outputDir: incoming.outputDir };
    await fs.writeFile(`${settingsFile()}.tmp`, JSON.stringify(next, null, 2), 'utf8');
    await fs.rename(`${settingsFile()}.tmp`, settingsFile());
    settings = next;
    return settings;
  });
  handle('engine:status', () => checkEngine(settings, bundledDir()));
  handle('dialog:file', async () => {
    if (process.argv.includes('--smoke')) return path.resolve(process.argv.includes('--smoke-gif') ? '.test-output/preview-tests/variable.gif' : '.test-output/中文 空格 $素材.mp4');
    const result = await dialog.showOpenDialog(window, { title: '打开 MP4 或 GIF', properties: ['openFile'], filters: [{ name: '视频和动画', extensions: ['mp4', 'gif'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('dialog:directory', async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择输出文件夹', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('dialog:executable', async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择 FFmpeg / FFprobe', properties: ['openFile'], filters: [{ name: '可执行文件', extensions: ['exe'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('media:inspect', async (input: string) => {
    if (engine.busy) throw new Error('请先完成或取消当前任务。');
    const info = await inspectMedia(input, await resolveBinaries(settings, bundledDir()));
    approvedFiles.add(info.path);
    return { ...info, url: fileUrl(info.path, true) };
  });
  handle('media:preview', async (input: string) => {
    authorizedFile(input);
    const asset = await previews.source(input, await resolveBinaries(settings, bundledDir()));
    return fileUrl(asset.path);
  });
  handle('preview:frame', async (input: string, time: number) => {
    authorizedFile(input);
    const asset = await previews.frame(input, time, await resolveBinaries(settings, bundledDir()));
    return { ...asset, url: fileUrl(asset.path), playbackUrl: asset.playbackPath ? fileUrl(asset.playbackPath) : undefined };
  });
  handle('preview:result', async (options: ExportOptions) => {
    authorizedFile(options?.input);
    if (engine.busy) throw new Error('请等待导出完成后再生成结果预览。');
    const asset = await previews.result(options, await resolveBinaries(settings, bundledDir()));
    return { ...asset, url: fileUrl(asset.path), playbackUrl: asset.playbackPath ? fileUrl(asset.playbackPath) : undefined };
  });
  handle('preview:cancel', () => previews.cancelResult());
  handle('app:github', () => shell.openExternal('https://github.com/yfxu221/ffmpeg_ui'));
  handle('job:start', async (options: ExportOptions) => {
    authorizedFile(options?.input);
    return engine.start(options, await resolveBinaries(settings, bundledDir()));
  });
  handle('job:command', async (options: ExportOptions) => {
    authorizedFile(options?.input);
    const binaries = await resolveBinaries(settings, bundledDir());
    const media = await inspectMedia(options.input, binaries);
    options = validateOptions(options, media);
    return displayCommand(binaries.ffmpeg, buildArguments(options, path.join(options.outputDir, `${path.parse(media.name).name}_export.${options.format}`)));
  });
  handle('job:cancel', () => engine.cancel());
  handle('file:reveal', (input: string) => { authorizedFile(input); shell.showItemInFolder(input); });
  handle('file:open', async (input: string) => { authorizedFile(input); const error = await shell.openPath(input); if (error) throw new Error(error); });
  ipcMain.on('window:action', (event, action: string) => {
    if (event.sender !== window.webContents) return;
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
  engine.on('progress', (progress: JobProgress) => {
    if (progress.state === 'completed') completedFiles.add(progress.output);
    if (window && !window.isDestroyed()) {
      window.webContents.send('job:progress', progress);
      window.setProgressBar(progress.state === 'running' ? progress.percent / 100 : -1);
    }
  });
  await createWindow();
  if (process.argv.includes('--smoke')) {
    await window.webContents.insertCSS('*{transition:none!important;scroll-behavior:auto!important;}');
    const { runSmoke } = process.argv.includes('--smoke-gif') ? await import('./smoke-gif') : await import('./smoke');
    try {
      await runSmoke(window);
      await window.webContents.executeJavaScript("document.querySelectorAll('video,audio').forEach(e => { e.pause(); e.removeAttribute('src'); e.load(); })");
      await previews.dispose(); app.exit(0);
    } catch (error) { console.error(error); await previews.dispose().catch(() => {}); app.exit(1); }
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(initialize).catch(error => { dialog.showErrorBox('FrameForge 启动失败', String(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitCleanupStarted) return;
    event.preventDefault();
    quitCleanupStarted = true;
    closing = true;
    stopCaptures();
    void engine.cancel().then(async () => {
      await previews?.dispose().catch(() => {});
    }).finally(() => app.quit());
  });
}
