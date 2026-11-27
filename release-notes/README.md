# 发版说明（release notes）

一个版本一个文件，命名固定：`RELEASE-NOTES-<版本>.txt`，例如 `RELEASE-NOTES-2.4.10.txt`。

- 已发布版本的说明**保留不动**（改历史说明会让老 Release 的正文和仓库对不上）。
- 新版本由 CI 直接取这个目录里的同名文件当 GitHub Release 正文；找不到才退回 CI 生成的简短模板。
- 文件名里的 `<版本>` 不带 `v` 前缀，和 `tag` 去掉 `v` 之后完全一致（beta 也一样：`RELEASE-NOTES-2.4.10-beta.1.txt`）。
- 内容用 UTF-8、纯文本，开头一行写 `we-mpkg <版本>`，下面按 `##` 分块；CI 会原样贴进 Release 正文。

发版步骤与检查项见仓库根目录的 [RELEASING.md](../RELEASING.md)。
