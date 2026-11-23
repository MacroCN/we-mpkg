# TEX 编码转换对照（依据 notscuffed/repkg）

这篇文档把 `src/tex.js` 的读写规则对着 [notscuffed/repkg](https://github.com/notscuffed/repkg)（C# 版，PKG/TEX 格式的逆向来源）重新梳了一遍：哪些字段必须照抄、哪些必须改写、手机版最后要长什么样。

## 1. 文件布局

```
"TEXV0005\0"
"TEXI0001\0"
header: 7 × int32
    format        // TexFormat，见下表
    flags         // TexFlags，见下表
    textureWidth  // 纹理资源宽（一般与 imageWidth 相同）
    textureHeight
    imageWidth    // 逻辑图宽，场景里按这个算尺寸
    imageHeight
    unk           // 原值照抄，别动
"TEXB000x\0"     // 图片容器版本
    int32 imageCount
    （TEXB0003）int32 imageFormat
    （TEXB0004）int32 imageFormat, int32 isVideoMp4
    imageCount × 图片：
        int32 mipCount
        mipCount × mip 记录
（flags 含 IsGif 时）帧容器 TEXS000x，原样跟在后面
```

mip 记录按容器版本分三种写法：

| 容器 | mip 记录 |
| --- | --- |
| TEXB0001 | `w, h, byteCount, bytes` |
| TEXB0002 / TEXB0003 | `w, h, isLZ4, decompressedBytes, byteCount, bytes` |
| TEXB0004 + MP4 | `1, 2, conditionJson, 1, w, h, isLZ4, decompressedBytes, byteCount, bytes` |
| TEXB0004 + 非 MP4 | 按 TEXB0002/0003 读（repkg 里同样是「版本降级」） |

## 2. 枚举

`header.format`（repkg `TexFormat`）：

| 值 | 含义 | 手机端能不能直接读 |
| --- | --- | --- |
| 0 | RGBA8888 | 能 |
| 4 | DXT5 | 一般不能（无 S3TC） |
| 5 | ETC2_RGBA8 | 能（移动端原生格式） |
| 6 | DXT3 | 一般不能 |
| 7 | DXT1 | 一般不能 |
| 8 | RG88 | 能（按两通道展开） |
| 9 | R8 | 能（灰度展开） |

`header.flags`（repkg `TexFlags`）：`1=NoInterpolation`、`2=ClampUVs`、`4=IsGif`、`32=IsVideoTexture`。这些位只影响采样参数，转换时必须原样写回，不能清 0。

`imageFormat`（repkg `FreeImageFormat`）：`-1=UNKNOWN`、`2=JPEG`、`13=PNG`、`25=GIF`、`35=MP4`；`-1` 且 `isVideoMp4=1` 时才等价于 MP4。

判断一个 mip 的真实载荷类型：`imageFormat != -1` 时按 `imageFormat`，否则按 `header.format`；两种都不认的，退回按载荷首字节猜（PNG 的 `89 50 4E 47`、JPEG 的 `FF D8`）。

## 3. 分流规则

1. `MP4` 或 `IsVideoTexture` → 视频纹理，不碰。
2. 已经是手机形态（`TEXB0004 + imageFormat=-1 + 单 mip + RGBA8/ETC2`）→ 原样保留。
3. `imageFormat` 指向图片（JPEG/PNG/GIF）→ 解码成 RGBA8。
4. DXT1/3/5 → 解码成 RGBA8。
5. RGBA8 / R8 / RG88 → 重封装成统一的手机形态。
6. 其它 / 解析失败 → 保留原文件并告警。

## 4. 手机形态（本工具写出的样子）

```
TEXV0005 / TEXI0001
header: format=0(RGBA8888), flags=原值, 尺寸=输出尺寸, unk=原值
TEXB0004, imageCount, imageFormat=-1, isVideoMp4=0
每帧：mipCount=1, w, h, isLZ4, decompressedBytes(w*h*4), byteCount, payload
```

`lz4` 压缩后不比原图小 16 字节以上就退回未压缩（`isLZ4=0`），移动端两种都能读。写完必须自校验：重新解析自己的输出，断言 format/容器/imageFormat/mip 数/解压长度/帧表都没被改动。

## 5. 这次重梳理修掉的坑

- **渐进式大 JPEG 解不出来**：`jpeg-js` 默认只给 512MB 内存、100MP 上限，6000×4500 的渐进图直接被它自己拦下，`decodeJpeg` 返回 null → 整个纹理判成「无法解码」→ 原图直通 → 手机端读不出来（黑屏只剩清屏色）。现在按图片体积把 `maxMemoryUsageInMB` / `maxResolutionInMP` 顶上去，并把真实解码失败原因带到告警里。
- **预算把大图一刀切**：默认 96MB 解码预算会把 6000×4500（约 103MB）判成「超预算保留原文件」，同样是原图直通。默认预算提到 192MB；仍超预算时的告警直接写明「原样保留手机端读不出来」。
- **超尺寸彩色图不降采样**：`materials/1.tex` 这种文件名没有语义线索，之前判成 `unknown` 不做降采样，6000×4500 会原尺寸写进 mpkg（两张就 112MB）。现在「JPEG/PNG 直通图 + 无语义线索」按彩色图处理，按画质档位降到 4096 以内。
- **GIF 帧表**：动图不降采样，帧容器字节原样跟在 TEXB 后面（尺寸一变帧表就废）。
- **着色器侧的两个独立问题**（不属于 TEX，但同批修）：
  - `effects/xray` 原来靠引擎注入的 `g_PointerState`，我们曾额外声明了一次 `uniform vec4 g_PointerState;`，移动端报 uniform 重定义 → effect 编译失败 → 黑屏。已改为完全不干预。
  - 音频频谱材质 `float left[N] = g_AudioSpectrum32Left;`（uniform 数组整数组初始化）和 `#elif AUDIOSAMPLES == 32;`（多一个分号）在移动端编译不过，效果失效后纯色层露出白块。现已改写为「逐元素循环拷贝」并清掉预处理里的多余分号。
