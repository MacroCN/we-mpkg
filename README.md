# we-mpkg

把 **Wallpaper Engine（AppID 431960）创意工坊**里的壁纸，打包成 **手机版 `.mpkg`**，可直接在 Wallpaper Engine 安卓客户端里导入使用。

三种交付形态：Windows 命令行、网页界面（默认 `http://localhost:3090`）、安卓 App。内置纯 JS 下载/打包引擎，不依赖 SteamCMD，也不需要单独安装 Node。

- 当前版本：**2.2.0**（P1 落地：批量下载、设备画质推荐、打包前兼容性报告；P2 落地：自动更新检查、GitHub Actions 打 tag 自动构建发布）
- 开源协议：**MIT**（见 [LICENSE](LICENSE)）
- 已验证平台：Windows x64、Android 17（arm64-v8a）

---

## 功能

| 模块 | 说明 |
|---|---|
| 创意工坊检索 | 浏览 / 搜索 / 标签筛选（Type、Age Rating、Genre、Resolution、Category、Asset Type…），筛选语义与官方客户端一致：**同一组内多选为「或」，不同组之间为「与」，某组不选即该组不过滤**；一次连续取 1/3/5 页，热门支持 7/30/90/365 天时间窗 |
| 内容范围 | 有 Steam 登录凭据时自动带上账号登录态，抓到的条目范围与桌面客户端一致（含成人分级内容）；未登录则退回匿名范围，界面会标注 |
| 下载 | 纯 JS 引擎 `steamjs`：内置 Steam 登录 / manifest / depot 密钥 / CDN 分块下载，全平台（Windows / Linux / 安卓）；支持分块级断点续传、暂停继续、坏 CDN 节点自动剔除 |
| 打包 | 生成手机容器 `.mpkg`：容器魔数替换、纹理按 DXT1/3/5/R8/RG88/直通图解码为 RGBA8 并 LZ4 压缩、着色器 GLSL ES 兼容改写（含结构性补丁）、`project.json`/`preview.gif` 补齐；支持画质档位、断点续转、默认剥离音频 |
| 网页类壁纸 | 安卓客户端没有 Web 引擎，本工具把网页渲染成视频并按 `video` 类型封装；同时注入音频响应 API，音频可视化壁纸的频谱不再为 0 |
| 下载中心 | 下载/打包在独立进程里跑，网页关掉也不中断；最多 3 条同时下载，带字节级进度条、速度与 ETA；队列落盘，重启后自动续跑 |
| 安卓端 | 下载缓存放 `Android/data/com.wempkg.app/files/downloads`，打包成功自动清理、失败保留续传；成品用 `content://` 直接拉起「导入壁纸引擎」 |

---

## 下载

| 产物 | 用途 |
|---|---|
| `we-mpkg-portable-2.2.0.zip` | 绿色版，解压双击 `start.bat` 即用，自带 Node 22 运行时（约 60 MB） |
| `we-mpkg-android-2.2.0.apk` | 安卓安装包（arm64-v8a，约 69 MB） |
| `we-mpkg-src-2.2.0.zip` | 源码包（不含依赖与二进制） |

发布页：<https://github.com/MacroCN/we-mpkg/releases>

---

## 快速开始

### 1. 绿色版（Windows，推荐）

```
解压 we-mpkg-portable-2.2.0.zip
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

## 2.2.0 改进（P1 + 自动更新 + CI）

| # | 改动 | 说明 |
|---|---|---|
| 1 | **批量下载** | 列表卡片左上角可勾选，底部浮条显示「已选 N 项」，一次把多条加入下载中心（队列最多 3 条并发），可选择批量用的画质 |
| 2 | **设备画质推荐** | 用 `navigator.deviceMemory`、核心数与 WebGL renderer 估设备档位：老 GPU/低内存默认「流畅」，中端「均衡」，8 GB 以上「高画质」；详情页显示推荐依据，用户改过画质后记住选择 |
| 3 | **打包前兼容性报告** | 新增 `src/compat.js`：解包后先扫描 project.json / .tex / 视频 / 音频，输出「良好 / 需注意 / 大概率黑屏」、纹理数量、视频纹理、预计显存、体积，以及本机是否具备 ffmpeg/浏览器；打包开始时推进度事件，界面直接展示 |
| 4 | **自动更新检查** | 新增 `src/update.js` + `GET /api/update/check`（6 小时缓存、`?force=1` 强制刷新）：对比 GitHub 最新 Release，设置页「检查更新」显示是否有新版本并给下载页链接；不做静默覆盖（绿色版文件占用、安卓需系统安装器） |
| 5 | **GitHub Actions 自动发布** | `.github/workflows/release.yml`：推 `v*` tag 后自动在 windows-latest 构建 portable/source zip、在 ubuntu-latest 用 NDK 编译 JNI + Gradle 打包 APK（16 KB 对齐 + debug 签名），三件套直接发布到 Release。APK 依赖预编译 libnode 与头文件，放在 `android-node-toolchain-v1` 工具链 Release |
| 6 | **版本号** | 2.2.0（versionCode 17 / versionName 2.2.0）；自检 90 通过 / 0 失败 |

### 这轮没做的两项（P1 里评估后暂缓）

- **安卓内置 ffmpeg / MediaCodec**：安卓 10+ 禁止执行 App 私有目录里的可执行文件，要么把 ffmpeg 伪装成 `lib*.so` 走 jniLibs（需要一个可信的 arm64 静态二进制），要么写 MediaCodec JNI 转码；两者都需要额外工具链与真机验证，这轮没有可靠来源，先不塞进 APK。兼容性报告会明确提示「安卓缺 ffmpeg，4K 视频纹理 / 网页类可能黑屏」。
- **ETC2 / ASTC 纹理编码**：需要 etc2comp / astcenc 编码器（同样是原生二进制），当前是 RGBA8 + LZ4；没有编码器时硬改格式只会产出坏纹理，因此仍按显存预算 + 降分辨率（画质档位）来控制。

## 2.1.2 改进（P0：代理 / 凭据 / 错误 / 保活）

| # | 改动 | 说明 |
|---|---|---|
| 1 | **设置页可填代理并测试** | 新增「设置 → 代理」输入框 + 「测试连通性」按钮（`POST /api/proxy/test`，只走指定代理请求 Steam WebAPI）；保存写入 `.cache/settings.json`，所有请求与后续 Steam 连接立即生效，留空则跟随系统/环境变量 |
| 2 | **凭据加密** | 新增 `src/securestore.js`：Windows 用 DPAPI（CurrentUser）加密 `.cache/steam-token.json` 与 `webcookies.json`；其它平台/安卓退回 AES-256-GCM + 本机密钥（App 私有目录）。旧明文文件仍能读，下次保存自动迁移 |
| 3 | **Steam 报错翻人话** | 新增 `src/errors.js`：EResult 15/21/24/50/63/84/85/88… 与 `ECONNREFUSED`/超时统一映射成可操作提示（例如「没买 Wallpaper Engine」「账号密码错误」「请求太频繁」「连不上 Steam，去设置页测代理」），下载与登录共用 |
| 4 | **安卓后台保活** | 新增 `KeepAliveService` 前台服务 + 常驻通知（类型 `dataSync`），下载/打包期间降低被系统回收概率；通知上「停止」等同退出（先 POST `/api/shutdown` 再结束进程）。Android 13+ 首次启动请求通知权限，拒绝也能跑 |
| 5 | **版本对齐** | README 当前版本、下载表、解压说明统一到 2.1.2；新增本节与 2.1.x 变更记录 |

## 2.1.x 改进（去掉 SteamCMD + 网络自愈）

| # | 改动 | 说明 |
|---|---|---|
| 1 | **彻底剥离 SteamCMD**（2.1.0） | 删除 `src/steamcmd.js`、`STEAMCMD_DIR` 与相关环境变量；命令行 `get/fetch` 改走内置 `steamjs`，支持 `--user/--pass`、`--interactive`（终端二维码）或复用 `.cache/steam-token.json` |
| 2 | **CDN 直连优先**（2.1.1） | 新增 `src/netagent.js`：每个新连接先直连，5 秒连不上再用代理 CONNECT 隧道；代理没配置或不通时不再把整个下载拖死 |
| 3 | **保存 .mpkg 链接修正**（2.1.1） | 桌面下载中心浮层改为 `/api/file/<任务ID>`，不再落到静态兜底变 `d1.txt` / 404 |

## 2.0.6 改进（视频纹理 + 下载中心暂停）

| # | 改动 | 说明 |
|---|---|---|
| 1 | **视频纹理壁纸不再黑屏** | 原来只按容器声明的 `videoMp4` 判断视频纹理，而官方视频纹理写的是 `imageFormat=-1 / videoMp4=0`，载荷其实是一段 MP4。结果 MP4 被当 RGBA 像素解，打包后又带着 `IsVideoTexture(32)` 标志，手机端按像素纹理去取视频流 → 整块黑。现在以 mip 载荷的 `ftyp`/EBML 头为准识别视频纹理：≤ 上限原字节保留，超限用 ffmpeg 转 H.264 Constrained Baseline + yuv420p（默认宽 1920，`WE_MPKG_VIDEO_MAX_WIDTH` 可调），再按官方 `TEXB0004 + imageFormat=-1 + videoMp4=0` 结构重封装。scene 与文字层（如 `时钟` + `getHours`）完全不动 |
| 2 | **非视频纹理清掉视频标志** | 转换输出统一 `flags & ~IsVideoTexture`，避免普通像素纹理带着视频标志被手机端误读 |
| 3 | **下载中心支持暂停 / 继续** | 新增 `POST /api/jobs/<id>/pause`、`/resume`，暂停挂在分块边界：已下的分块与 `.part.json` 断点全部保留，不重下不断连接；只有下载阶段可暂停（打包阶段按钮自动隐藏） |
| 4 | **下载中的任务也能移除** | 原来取消只在「下载完成后」检查一次，分块循环照跑到底，所以点取消/移除看起来没反应；且队列直接拒绝删除运行中任务。现在分块循环每个分块前检查取消，`forget` 对所有状态生效：运行/排队的任务先取消再从列表删掉，卡片立即消失 |

验证：单测 76 通过 / 0 失败（新增视频纹理四条 + 暂停/继续、取消打断、运行中 forget、HTTP 断言）；假 client 分块探针下，暂停期间只落下在飞的 4 个分块，取消在 0.6 秒内以 `cancelled` 退出（改前要跑满全部分块）。《星海花影的长发少女》（`3842466368`）实测：3840×2160 / 96 Mbps 的 6 秒视频重封装为 1920×1080 / 7.74 MB，scene 与时钟文字层保留，手机端正常播放。

---

## 2.0.5 改进（安全加固）

| # | 改动 | 说明 |
|---|---|---|
| 1 | **网页服务默认只监听本机** | 之前固定 `0.0.0.0`，同网段任何人都能打开界面并调用接口（接口本身没有身份验证）。现在默认 `127.0.0.1`；确实需要局域网访问时显式设 `WE_MPKG_HOST=0.0.0.0`，启动日志会提示「未启用身份验证，请勿暴露到不可信网络」 |
| 2 | **代理地址脱敏** | 之前 `/api/config` 会把 `WE_MPKG_PROXY` 原样返回，若代理带账号密码（`http://user:pass@host:port`）会直接暴露在页面接口里。现在只返回主机与端口（`http://host:port`），`user:pass@`、`https=` 前缀后的凭据都不再出现 |
| 3 | **下载文件句柄不再泄漏** | `downloadFileResumable` 原来在「拿不到节点列表 / 分块失败 / 校验不通过」等异常路径上会漏关文件句柄；现在统一在 `finally` 里关闭，只在成功路径做完整性校验与断点记录清理 |
| 4 | **测试覆盖** | 单测加到 71 条（新增代理脱敏断言）；`tools/test-resume.js` 新增「CDN 发现失败时文件句柄必须已关闭」的用例 |

验证：`node test/run-tests.js` 71 通过 / 0 失败；`node tools/test-resume.js` 全部通过；实际启动后监听地址为 `127.0.0.1`，`/api/config` 返回的 `proxy` 只保留「主机:端口」，账号密码已剥离。

---

## 2.0.4 改进（下载链路）

针对「第一个条目下完之后，后面每条都报 `Request timed out`」：根因不是代理，而是**取 manifest 这一步**——steam-user 随机挑一台 CDN、10 秒硬超时、失败不换源；而国内到这些边缘节点的建连抖动很常见（实测同一主机首次连接经常 10s+，第二次只要 0.2s）。第一条能成功是因为分块下载对每个 chunk 有 8 次重试，把抖动吃掉了；manifest 只有一次机会，所以第一条之后的每一条都死在 10 秒上。

这一版把下载链路按「官方客户端的方式」重做了一遍：

| # | 改动 | 说明 |
|---|---|---|
| 1 | **按客户端出口 IP 定地域优先级** | 启动时用 IP 归属接口（直连，不走代理）判断所在国家；国内用户优先阿里 / Edgenext 的国内边缘 + 港台集群，其次日新韩，欧美远端排最后。拿不到 IP 时可用 `WE_MPKG_CDN_COUNTRY=CN` 手动指定 |
| 2 | **每次启动测一遍节点延迟** | `GetServersForSteamPipe` 返回的全部节点（十几到二十台）并发测「TCP+TLS+首字节」，抖动大的补测一次取更小值；结果按 tier + 延迟排序落 `.cache/cdn-ranking.json`，下载中心进程直接复用 |
| 3 | **界面里能看能测** | 设置页新增「下载节点」：显示出口地区、每台节点的延迟/地域/可用状态，一个「测速」按钮可随时重测（测速复用下载中心的 CM 连接，不会和正在跑的任务抢会话） |
| 4 | **失败按顺序换点，不再死磕一台** | 分块下载改成严格按测速顺序取节点，任何失败（含 `Request timed out`）都记为这台不可用并换下一台，全部失败后重置再来；manifest 也一样，最多按顺序试 4 台 |
| 5 | **不再留僵尸连接** | steam-user 的 CDN 请求超时后只 reject、不 abort；现在给 CDN 请求加 15 秒空闲兜底（比它自己的 10 秒晚，只关掉它已经放弃的请求），每个任务结束时再清一遍全局 agent 的闲置连接 |

实测（同一条 CM 连接连下两个条目，网络正在抖动的情况下）：

- 第一条：manifest 依次试 `alibaba`（10.0s 超时）→ `fastly`（10.0s 超时）→ `cache12-hkg1`（1.3s 成功），分块阶段多个节点超时后自动换到可用节点，**17.6 MB 下载完成**。
- 第二条（此前必挂的《出包王女-梦梦》）：manifest 直接 1.5s 取回，分块同样换点后**31.8 MB 下载完成**，没有再出现「整条任务被一次超时判死」。
- 命令行：`run.bat cdn --test` 立即重测并打印排序；不带 `--test` 显示上次结果。

另外修了下载中心浮层的老毛病：打开时可能落在屏幕外、拖动后被压扁或横跨半屏。原因是打开时面板还处于隐藏状态（量到宽高为 0，坐标算到视口外）、窄屏媒体查询与拖动写入的 `left/top` 互相打架、以及拖拽的指针捕获挂在了错误的元素上。现在改成先显示再量尺寸、宽度统一由 `min(420px, calc(100vw - 24px))` 决定、拖动只改 `left/top`，并在窗口缩放、旋转、任务增减时自动把面板夹回可见区域。

---

## 2.0.3 改进

这版针对「2.0.2 出了包但手机上还是白块、频谱不律动」，把着色器兼容从"改完看起来对"推进到**用真编译器逐条验证**，并修掉了几个让改写静默失效的坑。

| # | 问题 | 根因 | 落地方式 |
|---|---|---|---|
| 1 | 2.0.2 的着色器改写实际**一条都没生效** | 工程里的 shader 是 CRLF；`#elif ...;`、`float a[N] = ...;` 这些用 `$` 锚点的改写被行尾 `\r` 挡住，全部静默不匹配 → 打进包里的还是原始文本，真机照样白块 | `rewriteAll` 入口先 `\r\n → \n` 归一，处理完再还原换行风格；新增单测覆盖 CRLF |
| 2 | 算术混型漏改（`... * 2.0 - 1;`） | `lastOperand` 把 `2.0` 当成"成员访问 `2.` + `0`"拆开，结果判定不出 float，`- 1` 一直没补成 `1.0` | `lastOperand` 先认浮点字面量；单测覆盖 `vec3 * 2.0 - 1` |
| 3 | 构造器实参里的混型漏改（`vec4(pointer * 2 - 1, ...)`） | 只要处在 `vec2/vec3/vec4(...)` 里就整体跳过 | 构造器改为看**当前实参**是否含 float，`vec4(0,0,0,0)` 这类纯整数实参保持不动 |
| 4 | `int` 表达式塞进 `float` 变量（内置效果 godrays） | 桌面 GLSL 允许隐式转换，GLSL ES 3.00 不允许：`const float sampleDrop = sampleCount - 1;`、`(i / sampleDrop)` | 新增 `rewriteIntFloatMix`：纯整型右值包 `float(...)`，`int / float` 给 int 那侧套 `float()` |
| 5 | 改写结果会被**覆盖回原始文本** | 实测打包过程中解包/纹理阶段会把原始 shader 又写回去，`patchDir` 跑完等于白跑（waterripple 就是这么被打回原形的） | `adaptForMobile` 定稿前新增 `verifyShaders` 复检：逐个文件比对磁盘文本与改写结果，不一致就写回；改写本身做成幂等（重复跑不会变成 `floatfloat(...)`） |
| 6 | 缺少「改完到底能不能编译/画对」的证据 | 之前只做字符串层面的检查 | 新增开发工具 `tools/glslc.js`（无头 Edge + WebGL，按引擎方式预处理、递归解析 `#include`、注入引擎宏与 uniform）与 `tools/check-shaders.js`（整目录批量编译）、`tools/render-probe.js`（真渲染取像素统计）。**这两件只在开发期用，不进打包链路** |

验证结果（出包后从 mpkg 里解出来再编译，不是看源目录）：

- 《出包王女-梦梦》：16 个着色器 **全部编译通过**（`perspective`、`godrays` 系列、`waterripple`、频谱条 `simple_gradient_audio_bar`、3 组 `____________`）。
- 频谱条渲染探针：静音时 **100% 透明、0% 纯白**；有频谱数据时 15.4% 像素是彩色条、**纯白 0%** —— 也就是说这一层已经不可能再靠"没上色的白色实心块"露出来。
- 《黄泉 X-ray》：`xray.frag` / `xray.vert` 全部编译通过。
- `node test/run-tests.js`：**66 通过 / 0 失败**（新增 CRLF、浮点字面量、`float()` 包层、幂等四条）。

关于"跟随系统声音律动"：频谱数据来自引擎的 `g_AudioSpectrum16/32/64Left/Right`（手机端由 `sendAudioData` 送进来，不是壁纸自带音频 —— 这个壁纸本身没有音频文件）。shader 现在能正常编译，数据有就动、没数据就是完全透明的空层（不会再出现白块）。

---


## 2.0.2 改进

这版只修真机上真实翻车的两处：一是纹理读不出来（灰屏/黑屏），二是渲染出一块白块。纹理编码部分按 [notscuffed/repkg](https://github.com/notscuffed/repkg) 重新梳理了一遍（对照笔记：[docs/TEX编码转换与repkg对照.md](docs/TEX编码转换与repkg对照.md)）。

| # | 问题 | 根因 | 落地方式 |
|---|---|---|---|
| 1 | 部分壁纸手机端灰屏/黑屏 | 纹理是**渐进式 JPEG**（`TEXB0004` + `imageFormat=2`，6000×4500，解码约 103MB） | `src/tex.js` 的 `decodeJpeg` 不再用 jpeg-js 默认的 512MB/100MP 上限，改为按解码预算推导 `maxMemoryUsageInMB` / `maxResolutionInMP`；解码失败的真实原因现在会写进告警文案，不再只说"直通图无法解码" |
| 2 | 大图整体被"超预算"放过原图 | 96MB 解码预算太小，超了就直接保留原文件 → 手机读不出 | 默认预算 96MB → **192MB**；无文件名语义的直通图按 `color` 处理，让 6000×4500 正常降到 4096×3072 |
| 3 | X-ray 等效果整块不画（只剩清屏色） | 之前给 `xray` 着色器补了一行 `uniform vec4 g_PointerState;`，而引擎头部已经全局注入过 → 移动端 uniform 重定义编译失败 | `rewriteXray` 改成**完全不改写**（真机 `libscenejni.so` 字符串表可证 `g_PointerState` 由引擎提供） |
| 4 | 频谱类效果编译失败 | `#elif AUDIOSAMPLES == 32;` 这类预处理行尾多余分号；`float left[N] = g_AudioSpectrum32Left;` 整数组初始化在 GLSL ES 不合法 | 新增 `rewritePreprocessorCondition`（去掉 `#if/#elif` 行尾分号）与 `rewriteAudioSpectrumArray`（拆成声明 + `for` 循环逐元素拷贝） |
| 5 | 画面出现一块**白色实心矩形** | 纯色层（`models/util/solidlayer.json`）挂音频频谱效果，shader 在移动端编译失败后露出未上色的白色实心层 | 根因是频谱 shader 用浮点变量做数组下标（`left[i]`），移动端 GLSL ES 只接受常量下标表达式。新增 `rewriteDynamicArrayIndex`：把带动态下标的那条语句放进以数组长度为界的 `for` 循环、用相等判断挑元素，语义不变；层不再被删，`--drop-audio-layers` 可强制移除 |
| 6 | 音频频谱层「不亮」 | 默认剥离音频，频谱监听器（引擎侧 `g_AudioSpectrum*`）收不到数据，只能画一条平线 | `stripAudio` 检测场景里是否有音频频谱效果，有就**自动保留音频**并打印原因；音频文件不存在时仍按引擎的系统音频数据（`sendAudioData`）出效果 |
| 7 | 叠加层错位 / 整层消失 | 之前"看到音频层就删"，被删的层如果挂着文字/贴图子对象，子对象 `parent` 就成了孤儿；`alpha` 写成字符串时移动端按默认值渲染，叠加层变实心 | `repairSceneCompat`：音频层优先保留，只有 shader 改写后仍不可移植才移除；移除时把子层重挂到祖父层并告警；`alpha` 字符串归一为数字；孤儿父级断开；`alpha/color/multiply/blendmode` 一律不动。顺带：PNG 直通纹理按数据图处理（蒙版/叠加贴图不降采样，避免边缘糊掉发白） |
| 8 | 互动效果（鼠标/触摸）整块不画 | 部分材质的 shader 自己又写了一遍 `uniform vec4 g_PointerState;`，引擎头部已注入同名 uniform → 重定义编译失败 | `rewriteEngineUniformDecl` 去掉重复声明（`g_PointerState`/`g_ParallaxPosition`），用法一处不改；`xray` 仍保持"完全不改写"，互动脚本原样保留 |

删除/保留范围都有单测保护（`test/run-tests.js`，62 项）：频谱层可移植时保留、不可移植时才移除并重挂子层、`--drop-audio-layers` 强制移除、有频谱时保留音频、`alpha` 归一、叠加属性不被改动。

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
run.bat cdn                      查看上次的 CDN 节点测速结果
run.bat cdn --test               立即重测节点延迟并按顺序打印
run.bat steamjs login|status|logout|token|webcookie
```

`steamjs webcookie --refresh` 用于刷新创意工坊的账号登录态（默认缓存 12 小时，过期自动续）。

---

## 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `WE_MPKG_PROXY` / `HTTPS_PROXY` | HTTP 代理；也可在网页「设置 → 代理」里填并点「测试连通性」，保存后立即生效 | 自动读 Windows 系统代理 |
| `WE_MPKG_OUTPUT_DIR` | 成品输出目录（也可在网页里改） | 程序目录 `output/` |
| `WE_MPKG_DLHUB_PORT` | 下载中心端口 | `3091` |
| `WE_MPKG_DOWNLOAD_DIR` | 下载缓存目录 | 程序目录 `downloads/` |
| `WE_MPKG_KEEP_DOWNLOAD` | `1` = 打包后保留缓存 | 打包后清理 |
| `WE_MPKG_CDN_COUNTRY` | 强制指定测速的地域优先级（`CN` / `HK` / `US` …），IP 归属接口不可用时用 | 按出口 IP 自动判断 |
| `STEAM_API_KEY` | 走 `IPublishedFileService/QueryFiles`（每页 100 条，上限更高） | 空 |
| `STEAM_PASSWORD` | CLI `get` / `fetch` 配合 `--user` 做账号密码登录 | 空 |
| `PORT` | 网页端口 | `3090` |
| `WE_MPKG_HOST` | 网页服务监听地址；设为 `0.0.0.0` 可允许局域网访问（API 无身份验证，请勿暴露到不可信网络） | `127.0.0.1`（仅本机） |
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
| [DoctorMcKay/node-steam-user](https://github.com/DoctorMcKay/node-steam-user) · [node-steam-session](https://github.com/DoctorMcKay/node-steam-session) | 纯 JS 登录、CM 连接与 web 会话 cookie 换取 |
| [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile) | 安卓端内嵌 Node 运行时 |
| Chromium（Edge headless）· FFmpeg | 网页类壁纸渲染与视频/音频封装 |





