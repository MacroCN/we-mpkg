'use strict';
/**
 * ffmpeg 缺失时的统一指引。
 *
 * 本分支只做移动端：ffmpeg 由 APK 内置的 libffmpeg.so 提供，正常情况下不会缺。
 * 缺了说明安装包/原生库异常，直接提示重装；开发机可用 WEM_FFMPEG 指向自备新版。
 */
const path = require('path');

/** 开发机调试视频链路时可用：自备新版（旧版漏洞多，不做兜底） */
const DOWNLOAD_URL = 'https://ffmpeg.org/download.html';

function projectRoot() {
  return path.resolve(__dirname, '..');
}

/** 多行完整说明：写进日志、错误信息、打包警告 */
function missingHelp() {
  return [
    '没有找到 ffmpeg（视频纹理转码 / 音频解码需要它）。',
    '  内置 libffmpeg.so 缺失通常说明安装包损坏：重新安装 APK 即可。',
    '  开发机调试可设 WEM_FFMPEG=<ffmpeg 可执行文件的完整路径>（请用 7.x 以上新版）。',
    `  需要自备时从这里取：${DOWNLOAD_URL}`,
  ].join('\n');
}

/** 单行版：塞进任务警告、HTTP 错误这种一行显示的地方 */
function missingHelpShort() {
  return '缺少 ffmpeg：内置 libffmpeg.so 异常，请重新安装 APK；开发机可设 WEM_FFMPEG=<路径>';
}

module.exports = { DOWNLOAD_URL, missingHelp, missingHelpShort, projectRoot };
