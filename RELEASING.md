# 发版清单

打 tag 之前按顺序过一遍，前四步任一失败就先修，别急着发。

## 1. 升版本（三处必须一致）

- `package.json` 的 `version`
- `android/app/build.gradle` 的 `versionCode`（+1）与 `versionName`
- `public/index.html` 里所有 `?v=<版本>`（静态资源防缓存）

## 2. 写发版说明

`release-notes/RELEASE-NOTES-<版本>.txt`，UTF-8 纯文本，第一行 `we-mpkg <版本>`，下面按 `##` 分块。
文件名不带 `v`，要和 tag 去掉 `v` 后一致；CI 会把它原样当 Release 正文。

## 3. 跑测试

```
npm ci
node test/run-tests.js     # 全绿，0 失败
```

其中一条是 **assets 新鲜度守卫**：它会解包 `android/app/src/main/assets/nodejs-project.zip`，
与仓库里的 `bin/`、`src/`、`public/` 逐文件比对，不一致直接失败。

## 4. 重打 assets 并提交（容易忘的一步）

`nodejs-project.zip` 是**提交进仓库**的，Gradle / Android Studio 直接构建时打包的就是它；
忘了重打，别人用 IDE 构建出来的 APK 里还是旧 JS（CI 会自己 sync，所以发布产物是好的）。

```
cd android
.\build-apk.ps1 -Variant debug -Toolchain D:\SteamCMD\toolchain
cd ..
git status            # 应看到 nodejs-build.json 与 nodejs-project.zip 有改动
git add -A
git commit -m "chore(assets): 重打 nodejs-project.zip (<版本>)"
```

只想重打 zip、不想整包编译时，可以手动走 build-apk.ps1 里 `[3/5]` 那套：
把 `bin`/`src`/`public`/`package.json` 复制到 `android/app/src/main/assets/nodejs-project/`，
复制并 `node tools/prune-node-modules.js` 瘦身 `node_modules`，最后 `node tools/make-assets-bundle.js`。

## 5. 打 tag 发布

```
git tag v<版本> && git push origin v<版本>
```

`Release` 工作流会产出四件资产：APK、Windows 绿色版、源码包、发版说明。
tag 里带 `beta` 只出 APK，绿色版与源码包会跳过。

## 6. 发完自查

- 三个 job 是否全绿；只剩 `Gradle ... is out of date` 这条 notice 属正常（AGP 8.13 还不兼容 Gradle 9）。
- 下载 `we-mpkg-android-<版本>.apk`，拆 `assets/nodejs-project.zip` 看关键改动是否在里面
  （`python -c "import zipfile..."`，或直接看 zip 里对应文件的修改）。
- 本机仓库 `git status -sb` 应为 `main...origin/main`，不带 ahead/behind。

## 两个已知的坑

- **同步本机时别先 `git reset --hard`**：本机连不上 GitHub，靠快照/bundle 同步，
  `reset --hard` 会把刚覆盖的文件还原回旧版；先 `git add -A` 提交，再核对。
- PowerShell 脚本必须带 UTF-8 BOM（`build-portable.ps1` 尤其），JS 文件必须不带 BOM，测试有守卫。
