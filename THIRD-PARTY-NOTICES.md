# Third-party components

FrameForge application source is licensed under MIT. Third-party binaries and dependencies retain their original licenses.

- Electron: MIT; Chromium and embedded dependencies have separate licenses. The portable distribution includes Electron's `LICENSE` and `LICENSES.chromium.html` files beside the executable. https://www.electronjs.org/
- React / React DOM: MIT. https://github.com/facebook/react
- Lucide: ISC. https://github.com/lucide-icons/lucide
- FFmpeg / FFprobe: https://ffmpeg.org/legal.html

## Local FFmpeg build

The initial local package uses the already installed Windows FFmpeg build:

`N-122520-gb637624046-20260121`, built with GCC 15.2.0, with `--enable-gpl --enable-version3` and `libx264` enabled. Its FFmpeg portion is covered by GPL version 3 or later. Configuration includes additional third-party libraries with their own licenses.

FFmpeg source revision: https://github.com/FFmpeg/FFmpeg/tree/b637624046

GPL v3 license: https://www.gnu.org/licenses/gpl-3.0.html

The complete detected version and build configuration are stored in the portable application's `resources/bin/BUILD-INFO.txt`. This record describes the initial build only; custom binaries require their own matching source and notices.

This package is assembled for the user's local use. Before public redistribution, provide the actual license texts, notices, and corresponding source for the exact FFmpeg binary and its enabled dependencies as required by their licenses. A source link alone does not replace those distribution obligations.
