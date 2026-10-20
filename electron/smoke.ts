import type { BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { capture } from './engine';
import type { EngineStatus } from '../shared/types';

// Exercised only by the explicit --smoke switch, with an isolated user profile.
export async function runSmoke(window: BrowserWindow) {
  const outputDir = path.resolve('.test-output');
  await fs.mkdir(outputDir, { recursive: true });
  const errors: string[] = [];
  window.webContents.on('console-message', (_event, ...args: unknown[]) => {
    if (typeof args[0] === 'object' && args[0] && 'level' in args[0] && (args[0] as { level: string }).level === 'error') errors.push(JSON.stringify(args[0]));
  });
  const execute = <T = unknown>(code: string) => window.webContents.executeJavaScript(code) as Promise<T>;
  const screenshot = async (name: string) => {
    await new Promise(resolve => setTimeout(resolve, 250));
    await execute('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(outputDir, name), (await window.webContents.capturePage()).toPNG());
  };
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
  const selectTool = async (title: string) => {
    await execute(`Array.from(document.querySelector('[aria-label="媒体工具"]').querySelectorAll('button')).find(b => b.textContent.includes(${JSON.stringify(title)})).click()`);
    await new Promise(resolve => setTimeout(resolve, 100));
  };
  const exportAndWait = async () => {
    const previous = await execute<string | undefined>("document.querySelector('.completed-details > span')?.getAttribute('title')");
    await execute("document.querySelector('.export-button').click()");
    await waitFor(`Boolean(document.querySelector('.job-panel.failed')) || (Boolean(document.querySelector('.job-panel.completed')) && document.querySelector('.completed-details > span')?.getAttribute('title') !== ${JSON.stringify(previous ?? '')})`);
    if (await execute<boolean>("Boolean(document.querySelector('.job-panel.failed'))")) throw new Error(await execute<string>("document.querySelector('.job-panel.failed').innerText"));
    return execute<string>("document.querySelector('.completed-details > span').getAttribute('title')");
  };
  await selectTool('画面调整');
  await execute("document.querySelector('[aria-label=\"旋转 90 度\"]').click()");
  await waitFor("document.querySelector('[aria-label=\"旋转 90 度\"]').classList.contains('selected')");
  await execute("document.querySelector('[aria-label=\"启用画面裁切\"]').click()");
  await execute("(() => { const select = document.querySelector('[aria-label=\"裁切比例预设\"]'); select.value = '1'; select.dispatchEvent(new Event('change', { bubbles:true })); })()");
  await waitFor("Boolean(document.querySelector('.crop-rectangle'))");
  await execute("document.querySelector('.media-preview').scrollIntoView({block:'center',behavior:'instant'})");
  window.webContents.debugger.attach('1.3');
  const rect = await execute<{ x: number; y: number }>("(() => { const b = document.querySelector('.crop-rectangle').getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}; })()");
  const mouse = (type: string, x: number, y: number) => window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const originalX = await execute<number>("Number(document.querySelector('[aria-label=\"裁切左侧 X\"]').value)");
  await mouse('mousePressed', rect.x, rect.y);
  await mouse('mouseMoved', rect.x + 25, rect.y);
  await mouse('mouseReleased', rect.x + 25, rect.y);
  await new Promise(resolve => setTimeout(resolve, 100));
  if (await execute<number>("Number(document.querySelector('[aria-label=\"裁切左侧 X\"]').value)") <= originalX) throw new Error('Crop drag did not update pixel coordinates.');
  const corner = await execute<{x:number;y:number}>("(() => { const b = document.querySelector('.crop-rectangle').getBoundingClientRect(); return {x:b.right-2,y:b.bottom-2}; })()");
  await mouse('mousePressed', corner.x, corner.y);
  await mouse('mouseMoved', corner.x - 20, corner.y - 15);
  await mouse('mouseReleased', corner.x - 20, corner.y - 15);
  await new Promise(resolve => setTimeout(resolve, 100));
  const finalCrop = await execute<{width:number;height:number}>("({width:Number(document.querySelector('[aria-label=\"裁切宽度\"]').value),height:Number(document.querySelector('[aria-label=\"裁切高度\"]').value)})");
  if (finalCrop.width >= 180 || finalCrop.height >= 180) throw new Error('Crop corner resize did not update dimensions.');
  window.webContents.debugger.detach();
  await execute("(() => { const select = document.querySelector('[aria-label=\"播放倍速\"]'); select.value = '2'; select.dispatchEvent(new Event('change', { bubbles:true })); })()");
  await screenshot('06-adjustments.png');
  const adjusted = await exportAndWait();
  const engine = await execute<EngineStatus>("window.desktop.engineStatus()");
  const adjustedInfo = JSON.parse(await capture(engine.ffprobe, ['-v','error','-show_format','-show_streams','-of','json',adjusted]));
  if (adjustedInfo.streams[0].width !== Math.ceil(finalCrop.height / 2) * 2 || adjustedInfo.streams[0].height !== Math.ceil(finalCrop.width / 2) * 2 || Math.abs(Number(adjustedInfo.format.duration) - 2) > 0.15) throw new Error('Adjusted UI export has incorrect dimensions / duration.');
  await selectTool('素材提取');
  await waitFor("Boolean(document.querySelector('[aria-label=\"提取 MP3\"].selected'))");
  const audio = await exportAndWait();
  const audioInfo = JSON.parse(await capture(engine.ffprobe, ['-v','error','-show_streams','-of','json',audio]));
  if (audioInfo.streams.length !== 1 || audioInfo.streams[0].codec_name !== 'mp3') throw new Error('UI audio extraction failed.');
  await execute("document.querySelector('[aria-label=\"提取 PNG\"]').click()");
  await execute("(() => { const input = document.querySelector('[aria-label=\"取帧时间（秒）\"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input,'1'); input.dispatchEvent(new Event('input',{bubbles:true})); })()");
  await waitFor("document.querySelector('.output-summary').textContent.includes('1.000')");
  const still = await exportAndWait();
  const stillInfo = JSON.parse(await capture(engine.ffprobe, ['-v','error','-show_streams','-of','json',still]));
  if (stillInfo.streams[0].codec_name !== 'png' || stillInfo.streams[0].width !== 320) throw new Error('UI PNG extraction failed.');
  await execute("document.querySelector('.options-card').scrollIntoView({block:'center',behavior:'instant'})");
  await screenshot('07-extraction.png');
  window.setSize(1080, 760);
  await new Promise(resolve => setTimeout(resolve, 500));
  const smallLayout = await execute<{ horizontalOverflow: boolean }>("({ width: innerWidth, height: innerHeight, horizontalOverflow: document.querySelector('.workspace').scrollWidth > document.querySelector('.workspace').clientWidth })");
  if (smallLayout.horizontalOverflow) throw new Error('Small window has horizontal overflow.');
  await fs.writeFile(path.join(outputDir, '05-small-window.png'), (await window.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(outputDir, 'smoke-report.json'), JSON.stringify({ layout, smallLayout, errors, command, newFeatures: { cropDrag: true, cornerResize: true, finalCrop, adjusted, audio, still } }, null, 2));
  console.log('Desktop smoke passed:', JSON.stringify(layout));
}
