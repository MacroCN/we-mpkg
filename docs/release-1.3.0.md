## 12. 1.3.0 修正：音频可视化 / 工坊数量 / 类型筛选

### 12.1 音频可视化（音频响应）类壁纸修好了

**现象**：web 类型的音频可视化壁纸（例如 *Kinetic Lyrics* 一类）烘成 mp4 之后画面完全静止，看起来就是「坏了」。

**根因**：桌面版 WE 会把系统音频的频谱通过 `window.wallpaperRegisterAudioListener(fn)` 持续推给网页（128 字节：前 64 左声道、后 64 右声道，0~255）。安卓端没有 Web 引擎，我们在无头浏览器里烘视频时这层 API **根本不存在**，壁纸的监听器永远不会被调用，频谱全是 0，柱子自然一根都不动。

**做法**（`src/webrender.js`）：

1. **注入音频兼容层**：用 CDP `Page.addScriptToEvaluateOnNewDocument` 在页面任何脚本执行之前塞进同名 API：
   - 项目里带音频文件（`.mp3/.ogg/.oga/.wav/.m4a/.aac/.flac`，≥8 KB，取体积最大的那个）→ 页面里用 WebAudio `decodeAudioData` + `ChannelSplitter` + 两个 `AnalyserNode`（`fftSize=128`）取**真实频谱**；
   - 同一个音频再用 ffmpeg 转成 48 kHz 立体声 wav，作为 Chromium `--use-file-for-fake-audio-capture` 的假麦克风输入，顺带救活「用 `getUserMedia` 抓麦克风」的壁纸；
   - 没有音频文件、或 headless 环境没有音频设备（analyser 采到全 0）→ 退回**合成频谱**（低频厚、高频长尾 + 2 Hz 节拍脉冲 + 慢速起伏），保证画面在动而不是死平。
2. **把音频封进 mp4**：`encodeMp4` 支持 `audio` 参数，用 `-stream_loop -1` 循环原音轨、`aac 128k`、`-shortest` 截到视频长度。手机端播放这条 mp4 时画面和声音对得上。
3. **顺手修掉视口 bug**：`Emulation.setDeviceMetricsOverride` 之前传了 `mobile: true`，页面没有 `<meta name="viewport">` 时 Chromium 会按 980 px 的「经典移动布局宽度」排版——画面只有左侧一条，以前靠 letterbox 模糊填充才不明显。改 `mobile: false` 后布局宽度严格等于目标分辨率（自检日志里能看到「视口 360x640」）。

**自检**：`node tools\test-web-audio.js`
造一个只靠 `wallpaperRegisterAudioListener` 画音频柱的网页 + ffmpeg 生成 8 秒测试音轨，跑完整转换后检查两件事：

```
音频兼容层: demo.mp3（用于频谱 + 拟真麦克风输入）
视口 360x640
[web] mp4 完成 0.06 MB（整屏 · 含音频轨）
mp4: 65 KB，含音频流: true
帧间最大差异: 3.9%
音频可视化自检通过（画面随频谱变化 + mp4 带音频轨）
```

**局限**：手机端 WE 播视频壁纸会不会出声取决于客户端自己（它默认静音的可能性不低），所以「画面在动」是稳的、「能听见」不保证；没有自带音轨时用的是合成频谱，不是真实音乐同步。

### 12.2 「网页抓的比客户端少很多」——原因分析与已做的补救

客户端（桌面 WE）走的是 Steamworks `IPublishedFileService/QueryFiles`：登录态、后端全量索引、界面无限滚动。我们默认走社区网页 `workshop/browse/` 的 HTML，差距来自 5 处：

| # | 差异点 | 说明 | 1.3 的处理 |
| --- | --- | --- | --- |
| 1 | **一页固定 30 条** | 网页的 `numperpage` 参数实际会被忽略，永远 30 条/页；客户端是一直往下滚 | 工具栏加「每次加载 1 / 3 / 5 页」，服务端 `pages` 参数连续翻页、合并去重（上限 8 页），翻页按钮按页数步进 |
| 2 | **热门只覆盖最近 7 天** | `browsesort=trend` 默认带一个时间窗（页面自己的下拉框默认 7 天）；客户端的「热门」是全时间轴排序 | 加「热门时间窗」7 / 30 / 90 / 365 天，只对 trend 生效（其它排序本来就不限时间） |
| 3 | **`section=readytouseitems`** | 社区页只列「当前可直接使用」的物品，作者隐藏 / 受限条目不上网页，客户端查询没这个 section | 改不了（属于社区站的语义），只能承认这块差集 |
| 4 | **匿名态内容过滤** | 社区页按 cookie 做地区、成人内容过滤；我们只塞了年龄确认 cookie（`wants_mature_content=1` 等），没有 `steamLoginSecure`，所以拿的是「未登录用户」的范围 | 暂未处理：要更接近得把浏览器登录态 cookie 也带上 |
| 5 | **API 模式上限更高** | `QueryFiles` 的 `numperpage` 能到 100，但要 `STEAM_API_KEY` | 配了 key 就走 API，同样是 100 条/页 + 多页 + days |

`/api/browse` 新增 `pages`、`days` 两个参数（`pages` 上限 `workshop.MAX_DEEP_PAGES = 8`），返回里多了 `pagesFetched / pageStart / pageEnd`，状态栏会显示「共 N 条 · 已取第 a-b 页（m 条）」。

结论：**默认只有 30 条 + 热门只看 7 天** 是「少很多」的主因，1.3 把能补的都补了；剩下的差距是社区网页的 `section` 与匿名态限制，不是翻页能解决的。

### 12.3 筛选去掉「应用」（Application）类型

- `POPULAR_TAGS` 移除 `Application`，新增 `REMOVED_TAGS = {'application', '应用'}` 与 `isRemovedTag()`；
- 标签过滤、`buildBrowseUrl` 拼 `requiredtags`、QueryFiles 的 `requiredtags[]`、结果里的 `tags`、`getFilters()` 解析出的分组，全部过一遍剔除；
- Type 组现在只剩 **Scene / Video / Web**；`public/app.js` 的中文标签表也删掉了「应用」；
- 筛选分组解析脚本 `extractFilterGroups` 现在从 `workshop.js` 导出，方便自检。

### 12.4 自检结果

```
node test\run-tests.js        → 15 通过 / 0 失败（新增 [7] 检索与筛选 3 项）
node tools\test-resume.js     → 断点续传自检通过
node tools\test-web-audio.js  → 音频可视化自检通过
```
