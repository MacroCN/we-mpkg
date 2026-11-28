# we-mpkg-rs

**Rust 重构版安卓客户端**：从 `we-mpkg` 3.0.0 移动端分支独立出来的仓库，只做安卓。把 **Wallpaper Engine（AppID 431960）创意工坊**里的壁纸打包成手机版 `.mpkg`，直接在 Wallpaper Engine 安卓客户端导入使用。

纹理/图像编解码与容器处理全部走 Rust 引擎（`rust/tex-cli`，APK 内为 `librusttex.so`）：DXT1/3/5 解码、LZ4 编解码、直通图物化、PNG/JPEG/GIF 解码、多 mip 整包转换。JS 侧只保留路由、断点续转与兼容层；Node 运行时与 ffmpeg 均随 APK 附带，不依赖 SteamCMD。源码可 `node bin/wempkg.js` 运行命令行/网页界面做开发调试。

- 开源协议：**MIT**（见 [LICENSE](LICENSE)）
- 已验证平台：Android 17（arm64-v8a）

---

## 功能

| 模块 | 说明 |
|---|---|
| 创意工坊检索 | 浏览 / 搜索 / 标签筛选（Type、Age Rating、Genre、Resolution、Category、Asset Type…），筛选语义与官方客户端一致：**同一组内多选为「或」，不同组之间为「与」，某组不选即该组不过滤**；一次连续取 1/3/5 页，热门支持 7/30/90/365 天时间窗 |
| 内容范围 | 有 Steam 登录凭据时自动带上账号登录态，抓到的条目范围与桌面客户端一致（含成人分级内容）；未登录则退回匿名范围，界面会标注 |
| 下载 | 纯 JS 引擎 `steamjs`：内置 Steam 登录 / manifest / depot 密钥 / CDN 分块下载；支持分块级断点续传、暂停继续、坏 CDN 节点自动剔除 |
| 打包 | 生成手机容器 `.mpkg`：容器魔数替换、纹理按 DXT1/3/5/R8/RG88/直通图解码为 RGBA8 并 LZ4 压缩、着色器 GLSL ES 兼容改写（含结构性补丁）、`project.json`/`preview.gif` 补齐；支持画质档位、断点续转、默认剥离音频（检测到音频交互/频谱时自动保留，`--keep-audio` 强制保留、`--drop-audio` 强制剥离） |
| 网页类壁纸 | 安卓客户端没有 Web 引擎，本工具补成离线网页包（PWA：viewport、触屏适配、manifest、离线缓存），由 App 内置 WebView 打开 |
| 下载中心 | 下载/打包在独立进程里跑，网页关掉也不中断；最多 3 条同时下载，带字节级进度条、速度与 ETA；队列落盘，重启后自动续跑 |
| 安卓端 | 下载缓存放 `Android/data/com.wempkg.rs.app/files/downloads`，打包成功自动清理、失败保留续传；成品用 `content://` 直接拉起「导入壁纸引擎」 |

---

## 下载

| 产物 | 用途 |
|---|---|
| `we-mpkg-android-*.apk` | 安卓安装包（arm64-v8a，约 29 MB）；本分支只发布移动端 |

发布页：<https://github.com/MacroCN/we-mpkg/releases>

---

## 快速开始

### 1. 安卓安装

安装 `we-mpkg-android-*.apk`，首次启动按引导授予存储/网络权限即可。3.0 版与 2.4.x 可并存安装。

### 2. 源码运行

```bat
:: 需要 Node 18+（自带依赖见 package.json）
npm install
node bin\wempkg.js serve --port 3090
```

### 3. 安卓 App

安装 APK → 打开 → 右上角 ⚙ 登录 Steam（扫码 / 账号密码 + Steam App 确认 / 导入电脑上的凭据 Base64）→ 搜索壁纸 → 详情页「导入壁纸引擎」。

---

## 登录与凭据

打包下载**需要拥有 Wallpaper Engine 的账号**（该 App 是付费 App，匿名账号拿不到 depot 解密密钥，实测确认）。三种登录方式：

1. **扫码**（电脑上最省事）：`node bin/wempkg.js steamjs login`，用手机 Steam App 扫码确认。
2. **账号密码 + Steam Guard**：网页右上角 ⚙，或 `node bin/wempkg.js steamjs login --user 你的账号`。
3. **导入电脑上的凭据**：电脑执行 `node bin/wempkg.js steamjs token` 得到一段 Base64，粘进手机 App。

凭据只保存在本机 `.cache/steam-token.json`，不会上传到任何服务器。

---

## 支持的壁纸类型

| 类型 | 手机端结果 |
|---|---|
| `video` | 直接可用（原样封装） |
| `scene` | 可用（DXT/直通图解码成 RGBA8 并按 LZ4 压缩、着色器做移动端改写） |
| `web` | 不可打包 mpkg（手机端没有 Web 引擎）；用「下载原始资源」导出网页离线包（beta） |
| `application` | 不可用，依赖桌面运行时，已从筛选列表中移除 |

### 下载原始资源（beta）

详情页勾选「下载原始资源」后不再打包 mpkg，而是把原始资源打成 `<标题>_<id>_raw.zip`：

- `video`：工程原样打包（mp4、`project.json`、预览图都在）
- `scene`：先解包 `scene.pkg`，再把解包出来的原始文件打包（不做 RGBA8 转换，着色器保持原样）
- `web`：走离线网页包——注入 `viewport`、`we-touch.js`（触摸→鼠标事件、禁滚动/缩放/长按菜单）、
  `manifest.webmanifest` 与 `sw.js`（离线缓存，可「添加到桌面」），解压后用 Kiwi / Firefox 打开 `index.html`
- 完成按钮是「打开文件」（交给系统处理 zip）
- 音频策略：勾选后原始音频原样保留；不勾选（打包 mpkg）默认剥离音频，只有场景里检测到音频交互（频谱 / 音频响应）时才自动保留
- Web 条目的「下载并打包 MPKG」按钮会置灰，只能勾选原始资源导出

### 界面

- 顶栏「下载中心」是常驻任务条：直接显示运行数、排队数与总进度，关掉浮层也看得到，点一下展开浮层
- 卡片右上角标出 场景 / 视频 / 网页 / 应用；卡片底部有「＋ 加选」和「⬇ 直接下载」
  （按设备推荐画质入队，web 条目自动走原始资源），单个下载不必先开详情
- 详情抽屉的画质默认落在设备推荐档，并在选项上标「推荐」
- 设置弹窗拆成 账号 / 网络 / 输出 / 关于 四个 tab
- 失败任务直接给「重试」；网络类失败多给「换节点重试」（先重测节点再排队），掉登录给「重新登录」
- 成品可「打开所在文件夹」（`POST /api/reveal`，只允许输出/下载目录内的文件）

---


## 更新记录

各版本的改动与已知问题见 [GitHub Releases](https://github.com/MacroCN/we-mpkg/releases)，正文只描述当前功能。

## 命令行

```
node bin/wempkg.js serve                    启动网页界面（默认 3090）
node bin/wempkg.js dlhub                    只启动下载中心（默认 127.0.0.1:3091，独立进程）
node bin/wempkg.js browse --search 夜城      搜索创意工坊
node bin/wempkg.js browse --group "Genre:Anime,Fantasy" --group "Type:Video"
                                 按官方语义筛选：同组内「或」，组间「与」
node bin/wempkg.js browse --tag Scene,Video  多个标签同时命中（强制「与」）
node bin/wempkg.js info <id>                查看条目详情
node bin/wempkg.js get <id>                 下载 + 打包成 .mpkg（一步到位）
node bin/wempkg.js fetch <id>               只下载原始文件
node bin/wempkg.js pack <目录|.pkg>          把本地内容打成 .mpkg（支持 --quality / --keep-audio / --drop-audio / --resume / --video-magic）
node bin/wempkg.js inspect <目录|容器>       查看内部结构
node bin/wempkg.js cdn                      查看上次的 CDN 节点测速结果
node bin/wempkg.js cdn --test               立即重测节点延迟并按顺序打印
node bin/wempkg.js steamjs login|status|logout|token|webcookie
```

`steamjs webcookie --refresh` 用于刷新创意工坊的账号登录态（默认缓存 12 小时，过期自动续）。

---

## 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `WE_MPKG_PROXY` / `HTTPS_PROXY` | HTTP 代理；也可在网页「设置 → 代理」里填并点「测试连通性」，保存后立即生效 | 跟随安卓系统代理 / VPN |
| `WE_MPKG_OUTPUT_DIR` | 成品输出目录（也可在网页里改） | 程序目录 `output/` |
| `WE_MPKG_DLHUB_PORT` | 下载中心端口 | `3091` |
| `WE_MPKG_DOWNLOAD_DIR` | 下载缓存目录 | 程序目录 `downloads/` |
| `WE_MPKG_KEEP_DOWNLOAD` | `1` = 打包后保留缓存 | 打包后清理 |
| `WE_MPKG_CDN_COUNTRY` | 强制指定测速的地域优先级（`CN` / `HK` / `US` …），IP 归属接口不可用时用 | 按出口 IP 自动判断 |
| `STEAM_API_KEY` | 走 `IPublishedFileService/QueryFiles`（每页 100 条，上限更高） | 空 |
| `STEAM_PASSWORD` | CLI `get` / `fetch` 配合 `--user` 做账号密码登录 | 空 |
| `PORT` | 网页端口 | `3090` |
| `WE_MPKG_HOST` | 网页服务监听地址；设为 `0.0.0.0` 可允许局域网访问，此时必须同时设置 `WE_MPKG_TOKEN`，否则只监听本机 | `127.0.0.1`（仅本机） |
| `WE_MPKG_TOKEN` | 远程访问令牌；手机/其他电脑打开 `http://主机:3090/?token=...` 后写入 Cookie | 空 |
| `STEAM_LANG` / `STEAM_COUNTRY` | 社区页语言 / 地区 | `schinese` / 空 |

---

## 已知限制

1. **必须有 Wallpaper Engine 账号**：匿名下载该付费 App 的创意工坊条目会因缺少 depot 解密密钥失败。
2. **网页抓取与客户端仍有差集**：社区网页只列 `section=readytouseitems`（可直接使用的物品）、单页固定 30 条，作者隐藏或受限条目不上网页；登录态已解决「账号范围过滤」，其余靠翻页/时间窗/API 模式弥补。
3. **`application` 类型壁纸不可用**：依赖桌面运行时，无法在手机端还原。
4. **`scene` 纹理适配只覆盖常见 DXT 格式**；个别自定义着色器可能仍需手工调整。
5. **单机扫码登录有边界**：手机打不开自己的屏幕来扫码，只有一部手机时请用账号密码 + Steam App 推送确认。
6. **筛选是「组内或」的多次请求合并**：Steam 的 `requiredtags[]` 只支持「与」，所以同组多选会拆成多个组合分别请求再取并集——组合超过 8 个时退化为每组只取第一个标签，结果会是交集；这种模式下每次只取 1 页。
7. **超预算纹理不转换**：单张纹理解码超过 96MB 内存（默认）就原样保留、只告警；要放宽用 `--max-texture-mb`。
8. **视频容器魔数默认 `PKGM0020`**：这是我们真机验证过的组合；`PKGM0014` 是可选 A/B，未做逐机型验证。
9. **下载中心是进程内模式**：手机上不能多进程，App 在后台被杀掉时下载仍会中断。

---

## 开源协议

本项目现以 **MIT License** 授权。早期内部草稿曾使用 GPL-3.0，未对外分发；自 1.3.1 起仓库内全部代码与产物统一适用 MIT。

本项目基于 **MIT License** 开源，完整条款见 [LICENSE](LICENSE)。

Copyright (c) 2026 MacroCN

- 可自由使用、修改、合并、发布、分发、再许可和/或出售，包括商用与闭源集成；
- 唯一义务：在所有副本或实质性部分中保留上述版权声明与本许可声明；
- 本项目按“现状”提供，不附带任何明示或默示担保。

> 注意：以上是**软件代码**的授权。创意工坊内容是创作者的作品——请只下载你已订阅或有权使用的内容，不要二次分发或商用；也请勿用本工具批量镜像，这既违反 Steam 订阅协议，也不尊重创作者。

本项目部分实现移植或对齐了 MIT 项目，其版权与许可声明集中列在 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)，许可原文存于 `licenses/`，再分发时需一并保留。

---

## 致谢

本项目的容器格式、纹理处理与检索链路，来自以下开源项目与官方文档的经验，特此致谢：

| 项目 | 在本项目中的作用 |
|---|---|
| [Yuqi-Github/wallpaper-engine-download-web](https://github.com/Yuqi-Github/wallpaper-engine-download-web) | 创意工坊页面抓取与 `GetPublishedFileDetails` 补全信息的方案 |
| [nxdyy/pkg2mpkg](https://github.com/nxdyy/pkg2mpkg) | `.pkg` 与 `.mpkg` 容器结构差异（魔数、纹理载荷、`project.json`/`preview.gif`） |
| [ReZe20/repkg-Re](https://github.com/ReZe20/repkg-Re) | PC 包转手机包的口径：直通编码纹理必须物化为 RGBA8、DXT 块格式可直通、着色器 GLSL ES 改写 |
| [jiangdengke/repkg-gui-wallpaper-extractor](https://github.com/jiangdengke/repkg-gui-wallpaper-extractor) | RePKG 的解包/纹理转换思路与其目录约定 |
| [DoctorMcKay/node-steam-user](https://github.com/DoctorMcKay/node-steam-user) · [node-steam-session](https://github.com/DoctorMcKay/node-steam-session) | 纯 JS 登录、CM 连接与 web 会话 cookie 换取 |
| [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile) | 安卓端内嵌 Node 运行时 |
| FFmpeg（`libffmpeg.so`） | 视频纹理降分辨率与音频封装 |





