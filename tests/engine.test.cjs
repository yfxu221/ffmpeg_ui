const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { MediaEngine, resolveBinaries, capture, inspectMedia, buildArguments, validateOptions, displayCommand } = require('../dist-electron/electron/engine.js');
const root = path.resolve('.test-output');
const input = path.join(root, '中文 空格 $素材.mp4');
let binaries, media;
const settings = { ffmpegPath: '', ffprobePath: '', outputDir: '' };
const options = (extra = {}) => ({ input, tool: 'convert', format: 'gif', width: 160, fps: 10, start: 0.5, end: 2.5, quality: 'balanced', mute: false, loop: true, fastTrim: false, outputDir: root, ...extra });
async function run(extra, customBinaries = binaries) {
  const engine = new MediaEngine();
  const events = [];
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  engine.on('progress', progress => { events.push(progress); if (progress.state !== 'running') finish(progress); });
  await engine.start(options(extra), customBinaries);
  const result = await done;
  return { result, events, engine };
}
before(async () => {
  await fs.mkdir(root, { recursive: true });
  binaries = await resolveBinaries(settings);
  await capture(binaries.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
  media = await inspectMedia(input, binaries);
});
test('probe reads Unicode, spaces, $ and audio from real media', () => {
  assert.equal(media.width, 320); assert.equal(media.height, 180); assert.equal(media.hasAudio, true);
  assert.ok(Math.abs(media.duration - 4) < 0.1); assert.ok(media.fps > 23);
});
test('MP4 → GIF uses selected duration, dimensions and frame rate', async () => {
  const { result } = await run();
  assert.equal(result.state, 'completed', result.error);
  const gif = await inspectMedia(result.output, binaries);
  assert.equal(gif.format, 'gif'); assert.equal(gif.width, 160); assert.equal(gif.hasAudio, false);
  assert.ok(Math.abs(gif.duration - 2) < 0.15); assert.ok(Math.abs(gif.fps - 10) < 0.1);
});
test('GIF → MP4 pads odd widths and produces a finite compatible video', async () => {
  const converted = await run({ width: 161 });
  assert.equal(converted.result.state, 'completed', converted.result.error);
  const gif = await inspectMedia(converted.result.output, binaries);
  const { result } = await run({ input: gif.path, format: 'mp4', width: 0, fps: 0, start: 0, end: gif.duration });
  assert.equal(result.state, 'completed', result.error);
  const output = await inspectMedia(result.output, binaries);
  assert.equal(output.width % 2, 0); assert.equal(output.height % 2, 0); assert.equal(output.codec, 'h264');
  assert.ok(output.duration < 3); assert.equal(output.hasAudio, false);
});
test('MP4 compression preserves optional audio and honors mute', async () => {
  for (const mute of [false, true]) {
    const { result } = await run({ tool: 'compress', format: 'mp4', width: 161, fps: 15, mute });
    assert.equal(result.state, 'completed', result.error);
    const output = await inspectMedia(result.output, binaries);
    assert.equal(output.hasAudio, !mute); assert.equal(output.width, 162); assert.equal(output.fps, 15);
    assert.ok(Math.abs(output.duration - 2) < 0.15);
  }
});
test('accurate MP4 trim and fast stream copy both export', async () => {
  for (const fastTrim of [false, true]) {
    const { result } = await run({ tool: 'trim', format: 'mp4', width: 0, fps: 0, start: 1, end: 3, fastTrim });
    assert.equal(result.state, 'completed', result.error);
    const output = await inspectMedia(result.output, binaries);
    assert.equal(output.codec, 'h264'); assert.ok(output.duration > 0 && output.duration <= 4.2);
    if (!fastTrim) assert.ok(Math.abs(output.duration - 2) < 0.15);
  }
});
test('same-name exports are numbered and existing bytes are preserved', async () => {
  const first = await run();
  const before = await fs.readFile(first.result.output);
  const second = await run();
  assert.equal(second.result.state, 'completed', second.result.error);
  assert.notEqual(first.result.output, second.result.output);
  assert.deepEqual(await fs.readFile(first.result.output), before);
});
test('cancel terminates child process, frees slot and cleans temporary directory', async () => {
  const engine = new MediaEngine();
  const terminal = new Promise(resolve => engine.on('progress', progress => { if (progress.state !== 'running') resolve(progress); }));
  await engine.start(options({ width: 1920, fps: 60 }), binaries);
  await assert.rejects(engine.start(options(), binaries), /已有任务/);
  await new Promise(resolve => setTimeout(resolve, 150));
  await engine.cancel();
  assert.equal((await terminal).state, 'cancelled'); assert.equal(engine.busy, false);
  assert.deepEqual((await fs.readdir(root)).filter(name => name.startsWith('.frameforge-')), []);
});
test('failed encoder reports error and removes incomplete output', async () => {
  const { result, engine } = await run({}, { ...binaries, ffmpeg: process.execPath });
  assert.equal(result.state, 'failed'); assert.ok(result.error); assert.equal(engine.busy, false);
  assert.deepEqual((await fs.readdir(root)).filter(name => name.startsWith('.frameforge-')), []);
});
test('invalid ranges and formats are rejected before starting FFmpeg', async () => {
  assert.throws(() => validateOptions(options({ start: 3, end: 2 }), media), /结束时间/);
  assert.throws(() => validateOptions(options({ end: 10 }), media), /结束时间/);
  assert.throws(() => validateOptions(options({ fps: NaN }), media), /有效数字/);
  assert.throws(() => validateOptions(options({ width: -1 }), media), /宽度/);
  assert.throws(() => validateOptions(options({ format: 'exe' }), media), /处理类型/);
  await assert.rejects(inspectMedia(path.join(root, 'fake.exe'), binaries), /MP4/);
});
test('PowerShell command quotes paths literally and escapes single quotes', () => {
  const text = displayCommand('C:\\my tools\\ffmpeg.exe', ['-i', "D:\\a'`$b.mp4"]);
  assert.ok(text.startsWith("& 'C:\\my tools\\ffmpeg.exe'"));
  assert.ok(text.includes("a''`$b"));
  const args = buildArguments(options(), 'out.gif');
  assert.equal(args[args.indexOf('-i') + 1], input);
});
