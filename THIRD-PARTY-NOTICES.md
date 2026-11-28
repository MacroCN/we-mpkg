# 第三方组件与来源声明

本项目以 **MIT License** 授权（见 [LICENSE](LICENSE)）。下列第三方来源按各自许可使用，版权归其原作者所有。

## 代码层面的来源

以下文件包含来自 MIT 项目移植 / 对齐的实现，其许可原文已随仓库保留在 `licenses/` 目录：

| 文件 | 来源项目 | 使用方式 | 许可 |
|---|---|---|---|
| `src/shadercompat.js` | [ReZe20/repkg-Re](https://github.com/ReZe20/repkg-Re) | 着色器整数→浮点补全规则集移植自 `RePKG_Re.Application/Shader/ShaderCompatPatcher.cs` | MIT（[原文](licenses/repkg-Re-MIT.txt)） |
| `src/tex.js` | [ReZe20/repkg-Re](https://github.com/ReZe20/repkg-Re) | `.tex` 纹理容器解析与「直通编码图」物化格式对齐 `RePKG_Re.Application/Texture/MobileTextureMaterializer.cs` | MIT（[原文](licenses/repkg-Re-MIT.txt)） |
| `src/pkgformat.js` | [nxdyy/pkg2mpkg](https://github.com/nxdyy/pkg2mpkg) | `.pkg` / `.mpkg` 容器读写实现参考 | MIT（[原文](licenses/pkg2mpkg-MIT.txt)） |

## 思路参考（未复制代码）

| 项目 | 参考点 | 许可 |
|---|---|---|
| [jiangdengke/repkg-gui-wallpaper-extractor](https://github.com/jiangdengke/repkg-gui-wallpaper-extractor) | RePKG 的层级解包与纹理转换流程、目录约定 | MIT |
| [Yuqi-Github/wallpaper-engine-download-web](https://github.com/Yuqi-Github/wallpaper-engine-download-web) | 创意工坊页面抓取流程与 `GetPublishedFileDetails` 补全信息的做法 | 该仓库未声明许可证；本项目仅参考流程描述，自行实现，未沿用其代码 |

## 运行时依赖与随附程序

| 组件 | 许可 | 随附位置 |
|---|---|---|
| [node-steam-user](https://github.com/DoctorMcKay/node-steam-user) · [node-steam-session](https://github.com/DoctorMcKay/node-steam-session) · [steam-appticket](https://github.com/DoctorMcKay/node-steam-appticket) 等 | MIT | `node_modules/<包>/LICENSE` |
| 其余 npm 依赖（protobufjs、pngjs、qrcode、adm-zip…） | MIT / BSD / Apache-2.0 | 各包目录内的 `LICENSE` / `NOTICE` |
| [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile)（Node.js 运行时） | MIT（含内置 OpenSSL / ICU / V8 等声明） | 随 APK 分发（`libnode.so` 与 `nodejs-project.zip`）；`licenses/NodeJS-MIT.txt` 为兜底声明 |
| Chromium（Edge headless） | BSD 等 | **不随本项目分发**，仅在用户本机作为外部程序调用，用于网页类壁纸的渲染与封装 |
| FFmpeg Android arm64（`libffmpeg.so`） | LGPL v2.1+（不含 GPL 组件，启用 MediaCodec） | 随 APK 分发，用于手机本地把视频纹理和 video 类型降到当前画质档位。构建来源：<https://github.com/hzw1199/Android-FFmpeg-Prebuilt>（`ffmpeg-9.0/bin/ffmpeg`，SHA-256 `9085507B0DC32643B4D6D084A7E7D3469EF17907A7BA15C22D3997ED09C932AA`）；源码见 <https://github.com/FFmpeg/FFmpeg>。 |

## 再分发要求

若你分发本项目的副本或衍生作品，除保留本项目的 MIT 声明外，还需一并保留本文件与 `licenses/` 目录——这是上述 MIT 项目许可的强制要求（版权声明与许可声明须包含在所有副本或实质性部分中）。
