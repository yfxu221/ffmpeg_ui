# FrameForge

Windows 本地 MP4 / GIF 媒体工作台。Electron + React + TypeScript，macOS 风格浅色界面，FFmpeg 执行媒体处理。

## 直接使用

双击 `release/FrameForge-win32-x64/FrameForge.exe`。便携文件夹需要完整保留，不能只移动 EXE。也可以双击项目根目录的 `启动 FrameForge.vbs`；它会优先打开便携版，否则打开已构建的开发版本，不显示命令行窗口。

1. 拖入一个 MP4 / GIF，或按 `Ctrl + O` 选择文件。
2. 从左侧选择格式转换、片段截取或压缩与缩放。
3. 在预览下方设置时间范围，在右侧调整格式、尺寸、帧率与画质。
4. 选择输出目录，点击「开始处理」。完成后打开文件或所在文件夹。

所有处理均在本地执行。原文件不被覆盖；结果重名时自动添加编号。处理时可取消，未完成的输出会清理。

当前便携目录约 585 MiB，包含 Electron 与这台电脑使用的完整 FFmpeg 运行库。后续可以通过精简 FFmpeg 构建缩减体积。本地验收记录见 `VALIDATION.md`。

### 功能与边界

- MP4 → GIF：时间段、宽度、帧率、循环，逐帧自适应调色板。
- GIF → MP4：H.264 / yuv420p；奇数尺寸自动补齐为偶数。
- MP4 / GIF 截取与缩放；MP4 的高清、均衡、更小三个 CRF 预设。
- 精确截取默认重新编码；MP4 快速截取复制视频流，起止点可能因关键帧偏移。
- 保留可选音轨并转 AAC，或移除音频。GIF 不含音频。
- 输入信息、播放预览、导出进度、取消、命令预览、输出路径和工具路径设置。
- 记住画质、移除音频和 GIF 循环选项；时间范围在导入新素材后重置，避免沿用不适合当前文件的范围。
- 遇到不兼容的预览编码，可生成前 30 秒的静音兼容预览。该预览不影响原文件导出。
- GIF 预览按动画自身的速度循环播放，选择时间范围只影响导出；不提供 GIF 逐帧定位。
- 压缩不保证输出总是小于输入，尤其输入已经高度压缩时。GIF 的帧延迟存在百分之一秒精度限制。
- 第一版一次处理一个文件，暂不支持批量、画面裁剪、GPU 编码或自动更新。
- UI 的「跟随原始素材」不强制修改帧率；FFmpeg 可能按输出格式的时间基进行必要调整。

## 开发

需要 Node.js 24（或工具链支持的 LTS）、npm，以及带 `libx264`、`palettegen`、`paletteuse` 的 FFmpeg 与 FFprobe。

```powershell
npm install
# 新版 Electron 通过独立命令下载运行时：
npm exec install-electron
npm run dev
```

`npm run dev` 会自动启动 Vite 和桌面窗口；无需打开浏览器。修改主进程后需要重启开发命令。正式构建运行不启动本地 HTTP 服务。

```powershell
npm run build       # 类型检查、前端与主进程编译
npm start           # 打开已构建的桌面窗口
npm test            # 构建与真实 FFmpeg 集成测试
npm run smoke       # 桌面端导入、导出、预览与界面检查（先运行 npm test 生成素材）
npm run package     # 打包 Windows x64 便携文件夹
npm run smoke:packaged # 去掉开发工具 PATH，验证便携版的独立运行和实际导出
```

FFmpeg 查找顺序：偏好设置指定的路径 → 应用附带的 `resources/bin` → 系统 PATH。配置 FFmpeg 时，FFprobe 优先查找同目录。设置存于 Electron 的用户数据目录，不写入项目目录。

打包脚本使用系统 PATH 中的 FFmpeg / FFprobe，将同目录相关 DLL 一并复制后验证运行；可通过 `FRAMEFORGE_FFMPEG` 和 `FRAMEFORGE_FFPROBE` 环境变量指定打包版本。便携包可以在未安装 Node.js、Python、FFmpeg 的 Windows x64 电脑上运行。

## 代码结构

- `src/`：React 界面、样式与状态。
- `shared/types.ts`：受限桌面 API 与任务数据类型。
- `electron/main.ts`：桌面窗口、IPC、设置、受控媒体协议。
- `electron/preload.ts`：上下文隔离桥接，不向界面暴露 Node.js。
- `electron/engine.ts`：FFprobe、参数校验、命令构建、任务生命周期和输出发布。
- `tests/engine.test.cjs`：真实媒体集成测试。
- `scripts/`：开发、打包、图标生成和桌面检查入口。

媒体通过随机 token 的本地协议提供给播放器；界面不能直接读取任意磁盘文件。FFmpeg 使用参数数组启动，不经 shell 解释。命令预览采用 PowerShell 单引号语法。

## 分发说明

当前便携包用于本机使用和验证，不包含安装器、自动更新或代码签名。项目应用代码使用 MIT 许可；Electron、Chromium、FFmpeg 与其他依赖有各自许可。对外分发前请按 `THIRD-PARTY-NOTICES.md` 中记录的实际构建检查并准备第三方许可与对应源代码材料。
