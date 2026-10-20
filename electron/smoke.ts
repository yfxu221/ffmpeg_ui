import type { BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Exercised only by the explicit --smoke switch, with an isolated user profile.
export async function runSmoke(window: BrowserWindow) {
  const outputDir = path.resolve('.test-output');
  await fs.mkdir(outputDir, { recursive: true });
  const errors: string[] = [];
  window.webContents.on('console-message', (_event, ...args: unknown[]) => {
    if (typeof args[0] === 'object' && args[0] && 'level' in args[0] && (args[0] as { level: string }).level === 'error') errors.push(JSON.stringify(args[0]));
  });
  const execute = <T = unknown>(code: string) => window.webContents.executeJavaScript(code) as Promise<T>;
  const waitFor = async (expression: string) => {
    for (let i = 0; i < 160; i++) {
      if (await execute<boolean>(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Smoke timeout: ${expression}`);
  };
  await waitFor("document.querySelector('h1') && document.body.innerText.includes('FFmpeg 已就绪')");
  await new Promise(resolve => setTimeout(resolve, 300));
  await fs.writeFile(path.join(outputDir, '01-empty.png'), (await window.webContents.capturePage()).toPNG());
  await execute("document.querySelector('[aria-label=\"媒体工具\"]').querySelectorAll('button')[1].click()");
  await waitFor("document.querySelector('h1').textContent.includes('片段')");
  await execute("document.querySelector('[aria-label=\"媒体工具\"]').querySelectorAll('button')[0].click()");
  await execute("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('偏好设置')).click()");
  await waitFor("Boolean(document.querySelector('[role=dialog]'))");
  await fs.writeFile(path.join(outputDir, '02-settings.png'), (await window.webContents.capturePage()).toPNG());
  await execute("document.querySelector('[aria-label=\"关闭对话框\"]').click()");
  const fixture = path.join(outputDir, '中文 空格 $素材.mp4');
  await fs.access(fixture);
  // Mock only the OS file-picker result. Actual preload IPC and the media engine run unchanged.
  await execute("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('选择文件')).click()");
  await waitFor("document.querySelector('.media-file-row strong')?.textContent.includes('素材')");
  await new Promise(resolve => setTimeout(resolve, 800));
  await fs.writeFile(path.join(outputDir, '03-imported.png'), (await window.webContents.capturePage()).toPNG());
  await execute("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('开始处理')).click()");
  await waitFor("Boolean(document.querySelector('.job-panel.completed')) || Boolean(document.querySelector('.job-panel.failed'))");
  if (await execute<boolean>("Boolean(document.querySelector('.job-panel.failed'))")) throw new Error(await execute<string>("document.querySelector('.job-panel.failed').innerText"));
  await new Promise(resolve => setTimeout(resolve, 500));
  await fs.writeFile(path.join(outputDir, '04-completed.png'), (await window.webContents.capturePage()).toPNG());
  await execute("document.querySelector('[aria-label=\"查看 PowerShell 命令\"]').click()");
  await waitFor("Boolean(document.querySelector('.command-code'))");
  const command = await execute<string>("document.querySelector('.command-code').textContent");
  if (!command.includes('ffmpeg') || !command.includes('素材')) throw new Error('Command preview missing input.');
  const layout = await execute("({ width: innerWidth, height: innerHeight, horizontalOverflow: document.querySelector('.workspace').scrollWidth > document.querySelector('.workspace').clientWidth, preview: document.querySelector('video')?.readyState, errors: document.querySelector('[role=alert]')?.textContent })");
  await execute("document.querySelector('[aria-label=\"关闭对话框\"]').click()");
  window.setSize(1080, 760);
  await new Promise(resolve => setTimeout(resolve, 500));
  const smallLayout = await execute<{ horizontalOverflow: boolean }>("({ width: innerWidth, height: innerHeight, horizontalOverflow: document.querySelector('.workspace').scrollWidth > document.querySelector('.workspace').clientWidth })");
  if (smallLayout.horizontalOverflow) throw new Error('Small window has horizontal overflow.');
  await fs.writeFile(path.join(outputDir, '05-small-window.png'), (await window.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(outputDir, 'smoke-report.json'), JSON.stringify({ layout, smallLayout, errors, command }, null, 2));
  console.log('Desktop smoke passed:', JSON.stringify(layout));
}
