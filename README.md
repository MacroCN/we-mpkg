# we-mpkg

把 **Wallpaper Engine（AppID 431960）创意工坊**里的壁纸，打包成 **手机版 `.mpkg`**，可直接在 Wallpaper Engine 安卓客户端里导入使用。

三种交付形态：Windows 命令行、网页界面（默认 `http://localhost:3090`）、安卓 App。内置纯 JS 下载/打包引擎，不依赖 SteamCMD，也不需要单独安装 Node。

- 当前版本：**2.0.2**（纹理解码与着色器兼容修复，见 [2.0.2 改进](#202-改进)）
- 开源协议：**MIT**（见 [LICENSE](LICENSE)）
- 已验证平台：Windows x64、Android 17（arm64-v8a）

---

## 功能

| 模块 | 说明 |
|---|---|
| 创意工坊检索 | 浏览 / 搜索 / 标签筛选（Type、Age Rating、Genre、Resolution、Category、Asset Type…），筛选语义与官方客户端一致：**同一组内多选为「或」，不同组之间为「与」，某组不选即该组不过滤**；一次连续取 1/3/5 页，热门支持 7/30/90/365 天时间窗 |
| 内容范围 | 有 Steam 登录凭据时自动带上账号登录态，抓到的条目范围与桌面客户端一致（含成人分级内容）；未登录则退回匿名范围，界面会标注 |
| 下载 | 两种引擎：`steamjs`（纯 JS，默认，全平台含安卓）、`steamcmd`（Windows 可选用）；支持分块级断点续传、坏 CDN 节点自动剔除 |
| 打包 | 生成手机容器 `.mpkg`：容器魔数替换、纹理按 DXT1/3/5/R8/RG88/直通图解码为 RGBA8 并 LZ4 压缩、着色器 GLSL ES 兼容改写（含结构性补丁）、`project.json`/`preview.gif` 补齐；支持画质档位、断点续转、默认剥离音频 |
| 网页类壁纸 | 安卓客户端没有 Web 引擎，本工具把网页渲染成视频并按 `video` 类型封装；同时注入音频响应 API，音频可视化壁纸的频谱不再为 0 |
| 下载中心 | 下载/打包在独立进程里跑，网页关掉也不中断；最多 3 条同时下载，带字节级进度条、速度与 ETA；队列落盘，重启后自动续跑 |
| 安卓端 | 下载缓存放 `Android/data/com.wempkg.app/files/downloads`，打包成功自动清理、失败保留续传；成品用 `content://` 直接拉起「导入壁纸引擎」 |

---

## 下载

| 产物 | 用途 |
|---|---|
| `we-mpkg-portable-2.0.2.zip` | 绿色版，解压双击 `start.bat` 即用，自带 Node 22 运行时（约 38 MB） |
| `we-mpkg-android-2.0.2.apk` | 安卓安装包（arm64-v8a，约 70 MB） |
| `we-mpkg-src-2.0.2.zip` | 源码包（不含依赖与二进制） |

发布页：<https://github.com/MacroCN/we-mpkg/releases>

---

## 快速开始

### 1. 绿色版（Windows，推荐）

```
解压 we-mpkg-portable-2.0.2.zip
双击 start.bat          → 浏览器打开 http://localhost:3090
双击 stop.bat           → 关闭后台服务
双击 run.bat            → 命令行入口
```

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

1. **扫码**（电脑上最省事）：`run.bat steamjs login`，用手机 Steam App 扫码确认。
2. **账号密码 + Steam Guard**：网页右上角 ⚙，或 `run.bat steamjs login --user 你的账号`。
3. **导入电脑上的凭据**：电脑执行 `get-token.bat` 得到一段 Base64，粘进手机 App。

凭据只保存在本机 `.cache/steam-token.json`，不会上传到任何服务器。

---

## 支持的壁纸类型

| 类型 | 手机端结果 |
|---|---|
| `video` | 直接可用（原样封装） |
| `scene` | 可用（DXT/直通图解码成 RGBA8 并按 LZ4 压缩、着色器做移动端改写） |
| `web` | 可用（渲染成视频封装，含音频轨与音频响应频谱） |
| `application` | 不可用，依赖桌面运行时，已从筛选列表中移除 |

---

## 2.0.2 改进

这版只修真机上真实翻车的两处：一是纹理读不出来（灰屏/黑屏），二是渲染出一块白块。纹理编码部分按 [notscuffed/repkg](https://github.com/notscuffed/repkg) 重新梳理了一遍（对照笔记：[docs/TEX编码转换与repkg对照.md](docs/TEX编码转换与repkg对照.md)）。

| # | 问题 | 根因 | 落地方式 |
|---|---|---|---|
| 1 | 部分壁纸手机端灰屏/黑屏 | 纹理是**渐进式 JPEG**（`TEXB0004` + `imageFormat=2`，6000×4500，解码约 103MB） | `src/tex.js` 的 `decodeJpeg` 不再用 jpeg-js 默认的 512MB/100MP 上限，改为按解码预算推导 `maxMemoryUsageInMB` / `maxResolutionInMP`；解码失败的真实原因现在会写进告警文案，不再只说"直通图无法解码" |
| 2 | 大图整体被"超预算"放过原图 | 96MB 解码预算太小，超了就直接保留原文件 → 手机读不出 | 默认预算 96MB → **192MB**；无文件名语义的直通图按 `color` 处理，让 6000×4500 正常降到 4096×3072 |
| 3 | X-ray 等效果整块不画（只剩清屏色） | 之前给 `xray` 着色器补了一行 `uniform vec4 g_PointerState;`，而引擎头部已经全局注入过 → 移动端 uniform 重定义编译失败 | `rewriteXray` 改成**完全不改写**（真机 `libscenejni.so` 字符串表可证 `g_PointerState` 由引擎提供） |
| 4 | 频谱类效果编译失败 | `#elif AUDIOSAMPLES == 32;` 这类预处理行尾多余分号；`float left[N] = g_AudioSpectrum32Left;` 整数组初始化在 GLSL ES 不合法 | 新增 `rewritePreprocessorCondition`（去掉 `#if/#elif` 行尾分号）与 `rewriteAudioSpectrumArray`（拆成声明 + `for` 循环逐元素拷贝） |
| 5 | 画面出现一块**白色实心矩形** | 纯色层（`models/util/solidlayer.json`）挂音频频谱效果，shader 在移动端编译失败后露出未上色的白色实心层 | 新增 `dropAudioReactiveSolidLayers`：打包时自动移除「纯色层 + 音频频谱效果」的对象（默认已剥离音频，这层留着也没数据可画），日志与告警里写明移除了哪一层；主图、文字层、普通纯色层不动 |

删除范围有单测保护（`test/run-tests.js`，54 项）：普通纯色层保留、主图挂同一效果不删、被删对象的 `scene.json` 能正确重写。

---

## 2.0.1 改进

这版解决「下载/打包跑在网页进程里」的两个实际问题：关掉页面就断，一次只能跑一条。

| # | 改进 | 落地方式 |
|---|---|---|
| 1 | 下载跑在独立进程 | 新增 `bin/dlhub.js` 下载中心（默认 `http://127.0.0.1:3091`）：网页与主服务只负责投任务、读进度，真正的下载/打包在进程外独立的 Node 进程里。关掉网页、关掉主服务、`Stop-Process` 强杀主进程，任务都继续跑；只有显式退出（`stop.bat` / `/api/shutdown`）才一并停掉 |
| 2 | 队列持久化 + 续跑 | 队列与进度落 `.cache/dlhub-state.json`（原子写、600ms 节流、退出前 flush）。下载中心重启后，`downloading/packing` 自动回落 `queued` 继续跑；下载本身仍是分块级断点续传 |
| 3 | 并发上限 3 | `MAX_CONCURRENT = 3`，按当前运行数自动补位；历史保留 20 条超出自动裁剪 |
| 4 | 下载进度条 | 下载按**字节**算百分比（manifest 全文件总量 → 已完成文件 + 当前文件已收字节），带速度（EMA 平滑）与 ETA；转换阶段按纹理资源 `done/total` 推进，`prepare / write / shader / reference` 这类不确定阶段画流动条 |
| 5 | 下载中心浮层 | 主界面内悬浮卡片（不跳页）：任务卡片、阶段文案、进度条、取消 / 重试 / 移除、清空历史（页内二次确认）、`?dlc=1` 可直接展开；桌面端独立页 `/downloads` 仍保留作兜底 |
| 6 | 成品一键导入 | 安卓端成品按钮是「导入壁纸引擎」（原生 `content://` 直拉 WE，列表接口补 `outPath` 绝对路径）；桌面端仍是「保存 .mpkg」 |
| 7 | 安卓返回逻辑 | 返回键：先收浮层 → 再关抽屉/弹窗（网页 `__androidBack`）→ 再退到后台；不再隐藏网页、不再顺手杀进程、也不重新加载页面 |

一个实现上的坑：Steam 不允许同一个 refresh token 同时建两条 CM 会话（第二条取 manifest 直接 `403`）。所以下载中心内部改成**进程级共享单连接**——多条任务共用一个 client；分块请求本身是并发的，带宽该吃满还是吃满；连接异常时自动丢弃，下次重试换新连接。

安卓端没有多进程（nodejs-mobile），App 里下载中心退回「进程内 embedded 模式」，关页面同样不中断下载；但 App 被系统杀掉仍会断。

---

## 2.0 改进

这版把格式转换流水线按「手机端真正能读」的目标重做了一遍，参考了开源项目 WallHub2.0 的后端实现（未照搬其 ETC2 / JNI 方案）。逐条对应：

| # | 改进 | 落地方式 |
|---|---|---|
| 1 | 输出纹理走 LZ4 | 新增 `src/lz4.js`（纯 JS 块压缩/解压）。压完比原图还大就退回不压缩（`lz4=0`），移动端两种都能读 |
| 2 | DXT1/3/5 解码 | 新增 `src/dxt.js`，含 DXT2/4、三色透明模式、显式 4bit / 8bit alpha，解码后重编码为 RGBA8 |
| 3 | 单条读取 + 尺寸闸门 | `pkgformat.openPkg` 流式读容器（只读目录表，按条目取切片）；纹理默认 512MB 文件 / 96MB 解码内存上限，超限原样保留并告警 |
| 4 | 写完自校验 | `tex.verifyMobileTex` 重新解析输出，校验格式 / 容器 / 单 mip / 解压长度 / 宽高 / 动图帧表，不通过就抛错并回退原文件 |
| 5 | 纹理语义保护 | 按文件名判定 `data`（法线 / 遮罩 / 粗糙度…）与 `color`（albedo / 背景…），**只对彩色图降采样**，数据图只做无损重编码 |
| 6 | 画质档位 | `high`（原尺寸，≤4096）/ `balanced`（1/2，≤2048）/ `smooth`（1/4，≤1024）/ `original`；降采样用面积平均，能用现成 mip 就不重采样 |
| 7 | 计划 + 断点续转 | 新增 `src/convertplan.js`：先落 `convert-plan.json`（资源清单 + SHA256），`convert-checkpoint.json` 记录每个资源的输入 / 输出哈希；档位或音频开关变了，断点自动作废 |
| 8 | 着色器补丁扩充 | 新增 xray 的 `g_PointerState` 注入、打包音频频谱 `[i/4][i%4]` → `[int(i)]`、vec3 颜色累加器、`common_blur.h` 隐藏纹理声明、`sample` → `_sample`；所有替换只在代码区做，注释 / 字符串不动 |
| 9 | 音频默认剥离 + 开关 | 官方手机版导出也不带音频；默认删掉 mp3 / wav / ogg / flac / aac / m4a / opus 并在日志统计，`--keep-audio` 可保留 |
| 10 | 视频容器魔数 | 视频类默认仍是真机验证过的 `PKGM0020`，`--video-magic 0014` 可切成 `PKGM0014` 做 A/B |

新增命令行开关：

```
run.bat pack <目录|.pkg> --quality balanced --keep-audio --resume --max-texture-mb 128
```

- `--quality high|balanced|smooth|original`：画质档位（网页端在详情页下拉里选）
- `--keep-audio`：保留壁纸自带音频（默认剥离）
- `--resume`：沿用上次的工作目录与断点，中断后接着转
- `--max-texture-mb N`：单张纹理解码内存预算，默认 96
- `--video-magic 0014`：视频类容器改用 PKGM0014

取舍：纹理解码在 JS 里做，大图（4K×4K 级法线）会吃内存，所以有预算闸门；超预算的纹理保持原样（宁可不动，也不产出读不了的文件）。

---

## 命令行

```
run.bat serve                    启动网页界面（默认 3090）
run.bat dlhub                    只启动下载中心（默认 127.0.0.1:3091，独立进程）
run.bat browse --search 夜城      搜索创意工坊
run.bat browse --group "Genre:Anime,Fantasy" --group "Type:Video"
                                 按官方语义筛选：同组内「或」，组间「与」
run.bat browse --tag Scene,Video  多个标签同时命中（强制「与」）
run.bat info <id>                查看条目详情
run.bat get <id>                 下载 + 打包成 .mpkg（一步到位）
run.bat fetch <id>               只下载原始文件
run.bat pack <目录|.pkg>          把本地内容打成 .mpkg（支持 --quality / --keep-audio / --resume / --video-magic）
run.bat inspect <目录|容器>       查看内部结构
run.bat steamjs login|status|logout|token|webcookie
```

`steamjs webcookie --refresh` 用于刷新创意工坊的账号登录态（默认缓存 12 小时，过期自动续）。

---

## 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `WE_MPKG_PROXY` / `HTTPS_PROXY` | HTTP 代理，创意工坊页面直连不通时必填 | 自动读 Windows 系统代理 |
| `WE_MPKG_ENGINE` | `steamjs`（纯 JS）或 `steamcmd` | `steamjs` |
| `WE_MPKG_OUTPUT_DIR` | 成品输出目录（也可在网页里改） | 程序目录 `output/` |
| `WE_MPKG_DLHUB_PORT` | 下载中心端口 | `3091` |
| `WE_MPKG_DOWNLOAD_DIR` | 下载缓存目录 | 程序目录 `downloads/` |
| `WE_MPKG_KEEP_DOWNLOAD` | `1` = 打包后保留缓存 | 打包后清理 |
| `WE_MPKG_TIMEOUT_MS` | 单条下载超时 | `900000`（15 分钟） |
| `STEAM_API_KEY` | 走 `IPublishedFileService/QueryFiles`（每页 100 条，上限更高） | 空 |
| `STEAM_USERNAME` / `STEAM_PASSWORD` | SteamCMD 引擎的账号 | 空 |
| `PORT` | 网页端口 | `3090` |
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
9. **安卓端下载中心是进程内模式**：手机上不能多进程，App 在后台被杀掉时下载仍会中断；桌面端是真正的独立进程。

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
| [ValveSoftware/steamcmd](https://developer.valvesoftware.com/wiki/SteamCMD) | `workshop_download_item` 的用法与产物路径 |
| [DoctorMcKay/node-steam-user](https://github.com/DoctorMcKay/node-steam-user) · [node-steam-session](https://github.com/DoctorMcKay/node-steam-session) | 纯 JS 登录、CM 连接与 web 会话 cookie 换取 |
| [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile) | 安卓端内嵌 Node 运行时 |
| Chromium（Edge headless）· FFmpeg | 网页类壁纸渲染与视频/音频封装 |





