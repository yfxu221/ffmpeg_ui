const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MediaEngine, resolveBinaries, capture, inspectMedia, buildArguments, validateOptions, displayCommand } = require('../dist-electron/electron/engine.js');
const { NEUTRAL_EFFECTS } = require('../dist-electron/shared/geometry.js');
const root = path.resolve('.test-output');
const input = path.join(root, '中文 空格 $素材.mp4');
let binaries, media;
const settings = { ffmpegPath: '', ffprobePath: '', outputDir: '' };
const options = (extra = {}) => ({ input, tool: 'convert', format: 'gif', width: 160, fps: 10, start: 0.5, end: 2.5, quality: 'balanced', mute: false, loop: true, fastTrim: false, outputDir: root, effects: { ...NEUTRAL_EFFECTS }, frameTime: 0, ...extra });
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
  assert.throws(() => validateOptions(options({ start:media.duration+0.001, end:media.duration+0.049 }), media), /结束时间/);
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

const probeAny = async output => JSON.parse(await capture(binaries.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output]));
const effects = extra => ({ ...NEUTRAL_EFFECTS, ...extra });
test('MP3 and M4A extraction produce audio-only selected clips', async () => {
  for (const format of ['mp3', 'm4a']) {
    const { result } = await run({ tool: 'extract', format, start: 1, end: 3 });
    assert.equal(result.state, 'completed', result.error);
    const output = await probeAny(result.output);
    assert.equal(output.streams.length, 1); assert.equal(output.streams[0].codec_type, 'audio');
    assert.equal(output.streams[0].codec_name, format === 'mp3' ? 'mp3' : 'aac');
    assert.ok(Math.abs(Number(output.format.duration) - 2) < 0.15);
  }
});
test('PNG extraction matches a decoded source frame and ignores selected clip range', async () => {
  const { result } = await run({ tool: 'extract', format: 'png', frameTime: 1, start: 3, end: 2 });
  assert.equal(result.state, 'completed', result.error);
  const output = await probeAny(result.output);
  assert.equal(output.streams[0].width, 320); assert.equal(output.streams[0].height, 180);
  const hash = (file, seek = false) => capture(binaries.ffmpeg, ['-v','error', ...(seek ? ['-ss','1'] : []), '-i',file,'-frames:v','1','-an','-vf','format=rgb24','-f','md5','pipe:1']);
  assert.equal(await hash(result.output), await hash(input, true));
});
test('silent GIF input supports PNG extraction and rejects audio extraction', async () => {
  const converted = await run();
  const gif = await inspectMedia(converted.result.output, binaries);
  assert.throws(() => validateOptions(options({ input: gif.path, tool: 'extract', format: 'mp3', start: 0, end: gif.duration }), gif), /没有音轨/);
  const { result } = await run({ input: gif.path, tool: 'extract', format: 'png', frameTime: 0.5, start: 0, end: gif.duration });
  assert.equal(result.state, 'completed', result.error);
  assert.equal((await probeAny(result.output)).streams[0].codec_name, 'png');
});
test('speed changes preserve selected clip boundaries, audio duration and pitch', async () => {
  for (const speed of [0.25, 0.5, 1.5, 2, 4]) {
    const { result } = await run({ tool: 'adjust', format: 'mp4', width: 0, fps: 24, effects: effects({ speed }) });
    assert.equal(result.state, 'completed', result.error);
    const output = await probeAny(result.output);
    const expected = 2 / speed;
    for (const stream of output.streams) assert.ok(Math.abs(Number(stream.duration) - expected) < 0.16, `${speed}x ${stream.codec_type}: ${stream.duration} vs ${expected}`);
    const samples = execFileSync(binaries.ffmpeg, ['-v','error','-i',result.output,'-vn','-ac','1','-ar','8000','-f','f32le','pipe:1'], { windowsHide: true });
    let crossings = 0;
    for (let i = 401; i < 2000; i++) if ((samples.readFloatLE(i*4) >= 0) !== (samples.readFloatLE((i-1)*4) >= 0)) crossings++;
    const frequency = crossings / (2 * (1599 / 8000));
    assert.ok(frequency > 400 && frequency < 480, `${speed}x pitch shifted: ${frequency}`);
  }
});

async function quadrantFixture() {
  const file = path.join(root, 'quadrants.mp4');
  await capture(binaries.ffmpeg, ['-v','error','-y','-f','lavfi','-i','color=red:s=160x96:r=10:d=2,drawbox=x=80:y=0:w=80:h=48:color=green:t=fill,drawbox=x=0:y=48:w=80:h=48:color=blue:t=fill,drawbox=x=80:y=48:w=80:h=48:color=yellow:t=fill','-c:v','libx264','-pix_fmt','yuv420p',file]);
  return file;
}
function samplePixel(file, x, y) {
  return [...execFileSync(binaries.ffmpeg, ['-v','error','-i',file,'-vf',`crop=2:2:${x}:${y}:exact=1,format=rgb24`,'-frames:v','1','-threads:v','1','-f','rawvideo','pipe:1'], { windowsHide: true }).subarray(0,3)];
}
function assertColor(pixel, name) {
  const [r,g,b] = pixel;
  const matches = { red: r>180 && g<50 && b<50, green: g>80 && r<50 && b<50, blue: b>180 && r<50 && g<50, yellow: r>180 && g>180 && b<50 };
  assert.ok(matches[name], `Expected ${name}, got ${pixel}`);
}
test('clockwise rotations and mirror directions are verified by actual pixel colors', async () => {
  const file = await quadrantFixture();
  for (const [settings, topLeft] of [
    [{rotation:90}, 'blue'], [{rotation:180}, 'yellow'], [{rotation:270}, 'green'],
    [{flipH:true}, 'green'], [{flipV:true}, 'blue'],
  ]) {
    const { result } = await run({ input:file, tool:'adjust', format:'mp4', width:0, fps:0, start:0, end:1, effects:effects(settings) });
    assert.equal(result.state, 'completed', result.error);
    const output = await inspectMedia(result.output, binaries);
    assert.equal(output.width, settings.rotation % 180 ? 96 : 160);
    assertColor(samplePixel(result.output, 10, 10), topLeft);
  }
});
test('crop is applied before rotation, mirror and scale', async () => {
  const file = await quadrantFixture();
  const { result } = await run({ input:file, tool:'adjust', format:'mp4', width:192, fps:0, start:0, end:1,
    effects:effects({ crop:{x:80,y:0,width:80,height:96}, rotation:90, flipH:true }) });
  assert.equal(result.state, 'completed', result.error);
  const output = await inspectMedia(result.output, binaries);
  assert.equal(output.width, 192); assert.equal(output.height, 160);
  assertColor(samplePixel(result.output, 20, 20), 'green'); assertColor(samplePixel(result.output, 170, 20), 'yellow');
});
test('GIF adjustment supports crop, rotation and a changed playback duration', async () => {
  const converted = await run();
  const gif = await inspectMedia(converted.result.output, binaries);
  for (const speed of [0.5, 4]) {
    const { result } = await run({ input:gif.path, tool:'adjust', format:'gif', width:0, fps:0, start:0, end:gif.duration,
      effects:effects({ crop:{x:0,y:0,width:80,height:80}, rotation:90, speed }) });
    assert.equal(result.state, 'completed', result.error);
    const output = await inspectMedia(result.output, binaries);
    assert.equal(output.width, 80); assert.equal(output.height, 80);
    assert.ok(Math.abs(output.duration - gif.duration / speed) < 0.12, `${output.duration} vs ${gif.duration / speed}`);
  }
});
test('rotated input metadata uses displayed crop coordinates', async () => {
  const source = await quadrantFixture();
  const rotated = path.join(root, 'metadata-rotated.mp4');
  await capture(binaries.ffmpeg, ['-v','error','-y','-display_rotation:v:0','90','-i',source,'-c','copy',rotated]);
  const info = await inspectMedia(rotated, binaries);
  assert.equal(info.width, 96); assert.equal(info.height, 160);
  const { result } = await run({ input:rotated, tool:'adjust', format:'mp4', width:0, fps:0, start:0, end:1,
    effects:effects({ crop:{x:10,y:20,width:80,height:120}, rotation:90 }) });
  assert.equal(result.state, 'completed', result.error);
  const output = await inspectMedia(result.output, binaries);
  assert.equal(output.width, 120); assert.equal(output.height, 80);
});
test('invalid transforms, out-of-bounds crops and incompatible output types are rejected', () => {
  for (const invalid of [{ speed:0 }, { speed:8 }, { speed:NaN }, { rotation:45 }, { crop:{x:300,y:0,width:32,height:32} }, { crop:{x:0.5,y:0,width:80,height:80} }, { crop:{x:0,y:0,width:1,height:80} }]) {
    assert.throws(() => validateOptions(options({ tool:'adjust', effects:effects(invalid) }), media));
  }
  assert.throws(() => validateOptions(options({ effects:effects({flipH:true}) }), media), /画面调整/);
  assert.throws(() => validateOptions(options({ tool:'extract', format:'mp4' }), media), /素材提取/);
  assert.throws(() => validateOptions(options({ tool:'extract', format:'png', frameTime:media.duration }), media), /取帧时间/);
});
