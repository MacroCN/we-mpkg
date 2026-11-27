'use strict';
/**
 * ffmpeg 缺失时的统一指引。
 *
 * 为什么不内置旧版：工坊里的媒体文件是不可信的，旧版 ffmpeg（4.x）会拿
 * 多年积累的已知容器/解码器漏洞去解这些文件。所以桌面上只认「用户自己装的新版」，
 * 找不到就停下来告诉用户去哪儿下、放哪儿 —— 不静默降级、不假装成功。
 */
const path = require('path');

/** Windows 官方构建（essentials，含 ffmpeg/ffprobe），持续更新 */
const DOWNLOAD_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
/** 各平台下载汇总（macOS / Linux 从这里找包管理器或静态构建） */
const HOMEPAGE = 'https://ffmpeg.org/download.html';

function projectRoot() {
  return path.resolve(__dirname, '..');
}

/** 推荐放置位置：源码树 / 绿色版各自一个，候选列表里都会找 */
function installPath(root = projectRoot()) {
  return path.join(root, '.cache', 'toolchain', 'ffmpeg', 'bin', 'ffmpeg.exe');
}

/** 绿色版（解压出来的 portable 目录）里的位置 */
const PORTABLE_PATH = 'tools\\ffmpeg\\ffmpeg.exe';

/** 多行完整说明：写进日志、错误信息、打包警告 */
function missingHelp(root = projectRoot()) {
  return [
    '没有找到 ffmpeg（视频纹理转码 / 网页壁纸音频解码需要它，不会内置旧版给你兜底）。',
    `  1. 下载 Windows 构建：${DOWNLOAD_URL}`,
    `     其它平台从这里找：${HOMEPAGE}`,
    '  2. 解压下载的 zip，取出里面的 bin\\ffmpeg.exe（同目录的 ffprobe.exe 可一起放）',
    `  3. 放到这个位置：${installPath(root)}`,
    `     绿色版则放到：${PORTABLE_PATH}`,
    '     或者设环境变量 WEM_FFMPEG=<ffmpeg.exe 的完整绝对路径>（优先级最高）',
    '  4. 重启 we-mpkg 即可；设置页可以点「测试连通性」旁边重新打开一次确认',
  ].join('\n');
}

/** 单行版：塞进任务警告、HTTP 错误这种一行显示的地方 */
function missingHelpShort(root = projectRoot()) {
  return `缺少 ffmpeg：去 ${DOWNLOAD_URL} 下载，解压后把 bin\\ffmpeg.exe 放到 ${installPath(root)}（绿色版放 ${PORTABLE_PATH}），或设 WEM_FFMPEG=<路径>，然后重启`;
}

module.exports = { DOWNLOAD_URL, HOMEPAGE, PORTABLE_PATH, installPath, missingHelp, missingHelpShort, projectRoot };
