'use strict';
/**
 * 离线自检：不依赖 Steam 网络，用合成数据验证
 *   - PKG/MPKG 容器读写
 *   - 解包 / 打包 / 参考文件替换
 *   - 创意工坊页面 HTML 解析
 *   - 完整流水线（模拟的工坊目录 -> mpkg）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const zlib = require('zlib');

const pkgformat = require('../src/pkgformat');
const packer = require('../src/pack');
const workshop = require('../src/workshop');
const tex = require('../src/tex');
const { redactProxy } = require('../src/server');

let passed = 0;
let failed = 0;
const failures = [];

/** 测试用：NUL 结尾字符串 */
function sstr(s) {
  const b = Buffer.from(s, 'latin1');
  return Buffer.concat([b, Buffer.from([0])]);
}
/** 测试用：int32 小端 */
function i32Buf(n) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(Math.trunc(n), 0);
  return b;
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  ✘ ${name}\n      ${e.message}`);
  }
}

function tmp(name) {
  const dir = path.join(os.tmpdir(), `wempkg-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeScenePkg() {
  return pkgformat.buildPkg(pkgformat.MAGIC_PC, [
    { path: 'scene.json', data: Buffer.from('{"camera":{"fov":50},"objects":[]}') },
    { path: 'materials/particle.json', data: Buffer.from('{"passes":[]}') },
    { path: 'textures/背景.tex', data: Buffer.from('\u0000TEXV0005TEXI0001fake-tex-bytes') },
    { path: 'shaders/common.frag', data: Buffer.from('// pc shader') },
    { path: 'models/plane.json', data: Buffer.from('{"sprites":[]}') },
  ]);
}

function makeItemDir() {
  const dir = tmp('item');
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    type: 'scene',
    file: 'scene.pkg',
    title: 'Test Scene Wallpaper',
    workshopid: '123456789',
    general: { properties: {} },
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'scene.pkg'), makeScenePkg());
  fs.writeFileSync(path.join(dir, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  return dir;
}

console.log('\n[1] 容器读写');

test('公开代理地址时移除用户名和密码', () => {
  const display = redactProxy('http://user:secret@127.0.0.1:8080;https=user2:secret2@proxy.example:8443');
  assert.strictEqual(display, '127.0.0.1:8080;https=proxy.example:8443');
  assert.ok(!display.includes('secret'));
});

test('build -> parse 往返一致（含中文路径）', () => {
  const entries = [
    { path: 'project.json', data: Buffer.from('{"type":"video"}') },
    { path: 'materials/材质.json', data: Buffer.alloc(1024, 7) },
    { path: 'textures/a.tex', data: Buffer.alloc(333, 9) },
  ];
  const buf = pkgformat.buildPkg(pkgformat.MAGIC_MOBILE, entries);
  const parsed = pkgformat.parsePkg(buf);
  assert.strictEqual(parsed.magic, pkgformat.MAGIC_MOBILE);
  assert.strictEqual(parsed.entryCount, 3);
  assert.deepStrictEqual(parsed.entries.map((e) => e.path), entries.map((e) => e.path));
  for (let i = 0; i < entries.length; i++) {
    assert.strictEqual(parsed.entries[i].length, entries[i].data.length);
    assert.deepStrictEqual(parsed.entries[i].data, entries[i].data);
  }
});

test('offset/length 指向正确数据', () => {
  const buf = pkgformat.buildPkg(pkgformat.MAGIC_PC, [
    { path: 'a', data: Buffer.from('AAA') },
    { path: 'b', data: Buffer.from('BB') },
  ]);
  const parsed = pkgformat.parsePkg(buf);
  assert.strictEqual(parsed.entries[0].offset, 0);
  assert.strictEqual(parsed.entries[1].offset, 3);
  assert.strictEqual(parsed.entries[0].data.toString(), 'AAA');
});

test('非法 magic 会被拒绝', () => {
  const head = Buffer.alloc(4);
  head.writeInt32LE(5, 0);
  const bad = Buffer.concat([head, Buffer.from('HELLO')]);
  assert.throws(() => pkgformat.parsePkg(bad), /magic/);
});

console.log('\n[2] 解包与路径安全');

test('extractPkg 写出全部条目', () => {
  const dir = tmp('extract');
  const pkgPath = path.join(dir, 'scene.pkg');
  fs.writeFileSync(pkgPath, makeScenePkg());
  const out = path.join(dir, 'out');
  const res = pkgformat.extractPkg(pkgPath, out);
  assert.strictEqual(res.files.length, 5);
  assert.ok(fs.existsSync(path.join(out, 'scene.json')));
  assert.ok(fs.existsSync(path.join(out, 'textures', '背景.tex')));
});

test('路径穿越被拒绝', () => {
  const pkg = { entries: [{ path: '../evil.txt', data: Buffer.from('x') }] };
  const dir = tmp('safe');
  assert.throws(() => pkgformat.safeJoin(dir, '../evil.txt'), /不安全|逃逸/);
  assert.throws(() => pkgformat.safeJoin(dir, 'a/../../evil.txt'), /不安全|逃逸/);
  void pkg;
});

console.log('\n[3] 打包');

test('packDirToBuffer 把 project.json 放在最前', () => {
  const dir = tmp('pdir');
  fs.writeFileSync(path.join(dir, 'z.json'), '{}');
  fs.writeFileSync(path.join(dir, 'project.json'), '{}');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'a.txt'), 'a');
  const res = pkgformat.packDirToBuffer(dir, pkgformat.MAGIC_MOBILE);
  assert.strictEqual(res.entries[0].path, 'project.json');
  assert.strictEqual(res.entries.length, 3);
});

console.log('\n[4] 参考 mpkg 替换');

test('参考 mpkg 的 tex/着色器被替换，preview.gif 被补入', async () => {
  const itemDir = makeItemDir();
  const workDir = tmp('work');
  const prepared = packer.prepareProjectDir(itemDir, { workDir, onLog: () => {} });
  const refPath = path.join(workDir, 'ref.mpkg');
  const ref = pkgformat.buildPkg(pkgformat.MAGIC_MOBILE, [
    { path: 'project.json', data: Buffer.from('{"type":"scene","title":"mobile"}') },
    { path: 'preview.gif', data: Buffer.from('GIF89a-fake-preview') },
    { path: 'textures/背景.tex', data: Buffer.from('\u0000TEXV0005TEXI0001mobile-etc2-tex-with-different-length') },
    { path: 'shaders/common.frag', data: Buffer.from('// mobile shader v2') },
  ]);
  fs.writeFileSync(refPath, ref);
  const stats = packer.applyReference(prepared.projectDir, refPath, () => {});
  assert.strictEqual(stats.stats.tex, 1);
  assert.strictEqual(stats.stats.frag, 1);
  assert.ok(fs.existsSync(path.join(prepared.projectDir, 'preview.gif')));
  const tex = fs.readFileSync(path.join(prepared.projectDir, 'textures', '背景.tex')).toString();
  assert.ok(tex.includes('mobile-etc2'), 'tex 未被替换');
});

console.log('\n[5] 创意工坊页面解析');

const FIXTURE = `
<div class="workshopBrowsePagingInfo">Showing 1-2 of 12,345 entries</div>
<div class="workshopItem" data-publishedfileid="111111111">
  <a class="workshopItemAuthorName"><a href="https://steamcommunity.com/profiles/7656119">作者甲</a></a>
  <img class="workshopItemPreviewImage" src="https://images.steamusercontent.com/a.jpg">
  <div class="workshopItemTitle">星空夜景</div>
</div>
<div class="workshopItem" data-publishedfileid="222222222">
  <img class="workshopItemPreviewImage" src="https://images.steamusercontent.com/b.jpg">
  <div class="workshopItemTitle">Cyber City</div>
</div>`;

test('parseBrowseHtml 提取 id/标题/预览/总数', () => {
  const res = workshop.parseBrowseHtml(FIXTURE);
  assert.strictEqual(res.items.length, 2);
  assert.strictEqual(res.items[0].id, '111111111');
  assert.strictEqual(res.items[0].title, '星空夜景');
  assert.strictEqual(res.items[1].title, 'Cyber City');
  assert.ok(res.items[1].preview.includes('b.jpg'));
  assert.strictEqual(res.total, 12345);
});

test('buildBrowseUrl 参数正确（标签过多时放弃过滤）', () => {
  const url = workshop.buildBrowseUrl({ search: 'city night', sort: 'recent', tags: ['Scene', 'Video'], page: 2 });
  assert.ok(url.startsWith('https://steamcommunity.com/workshop/browse/?appid=431960'));
  assert.ok(url.includes('browsesort=mostrecent'));
  assert.ok(url.includes('p=2'));
  assert.ok(url.includes('searchtext=city%20night'));
  assert.ok(url.includes('requiredtags%5B%5D=Scene'));
  const many = workshop.buildBrowseUrl({ tags: Array.from({ length: 9 }, (_, i) => 't' + i) });
  assert.ok(!many.includes('requiredtags'), '超过 8 个标签应放弃过滤');
});

console.log('\n[6] 新版 SSR 页面');

test('SSR 页面（loaderData 嵌套 JSON 字符串）解析', () => {
  const data = {
    eresult: 1,
    current_page: 1,
    total_count: 12345,
    results: [{
      publishedfileid: '3841811070',
      title: 'SSR 壁纸',
      preview_url: 'https://images.steamusercontent.com/a.jpg',
      file_size: '1980000',
      time_created: 1794700000,
      time_updated: 1794800000,
      tags: [{ tag: 'Video', display_name: 'Video' }, { tag: 'Anime', display_name: 'Anime' }],
    }],
  };
  const state = { queryCache: [{ state: { data } }] };
  const ssr = { route: '/workshop/browse', loaderData: [JSON.stringify(state)] };
  const page = `<!DOCTYPE html><html><head><script type="application/json" id="valve-ssr-data">${JSON.stringify(ssr)}</script></head><body></body></html>`;
  const res = workshop.parseBrowseHtml(page);
  assert.strictEqual(res.legacy, false);
  assert.strictEqual(res.total, 12345);
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.items[0].title, 'SSR 壁纸');
  assert.strictEqual(res.items[0].fileSize, 1980000);
  assert.deepStrictEqual(res.items[0].tags, ['Video', 'Anime']);
});

console.log('\n[7] 1.3 检索与筛选');

test('官方已下线的「应用」类型被剔掉', () => {
  assert.ok(!workshop.POPULAR_TAGS.includes('Application'), 'POPULAR_TAGS 不应再有 Application');
  assert.ok(!workshop.buildBrowseUrl({ tags: ['Application', 'Scene'] }).includes('Application'), '构造 URL 时不应带 Application');
  assert.ok(workshop.isRemovedTag('application') && workshop.isRemovedTag('应用'));
});

test('筛选分组解析：Application 从类型组消失', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'logs', 'debug', 'ws.html'), 'utf8');
  const groups = workshop.extractFilterGroups(html);
  assert.ok(groups && groups.length, '应能解析出分组');
  for (const g of groups) {
    assert.ok(!g.tags.some((t) => workshop.isRemovedTag(t.name)), `${g.name} 组里仍有已下线标签`);
  }
  const type = groups.find((g) => g.name === 'Type');
  assert.ok(type && type.tags.length >= 3, 'Type 组应保留 Scene/Video/Web');
});

test('days 只在 trend 排序下拼进 URL', () => {
  const url = workshop.buildBrowseUrl({ sort: 'trend', days: 90 });
  assert.ok(url.includes('days=90'));
  const other = workshop.buildBrowseUrl({ sort: 'recent', days: 90 });
  assert.ok(!other.includes('days='), '非 trend 排序不该带 days');
});

console.log('\n[8] 创意工坊登录态（账号范围）');

test('从 cookie 里解析 steamID64', () => {
  const wc = require('../src/webcookie');
  assert.strictEqual(wc.steamIdFromCookie('steamLoginSecure=76561198000000001%7C%7CeyJhbGci; sessionid=abc'), '76561198000000001');
  assert.strictEqual(wc.steamIdFromCookie('sessionid=abc'), '');
  assert.strictEqual(wc.steamIdFromCookie(null), '');
});

test('登录 cookie 排在 steamCookie 最前，可置空退回匿名', () => {
  const net = require('../src/net');
  const before = net.steamCookie();
  net.setLoginCookie('steamLoginSecure=76561198000000001%7C%7CDUMMY');
  const withLogin = net.steamCookie();
  assert.ok(withLogin.startsWith('steamLoginSecure=76561198000000001'), '登录态必须放最前');
  assert.ok(withLogin.includes('mature_content=1'), '年龄确认等偏好 cookie 仍要保留');
  net.setLoginCookie('');
  assert.strictEqual(net.steamCookie(), before.replace(/^;\s*/, ''), '置空后应完全回到匿名 cookie');
});

test('缓存状态与账号一致性', () => {
  const wc = require('../src/webcookie');
  const s = wc.cachedStatus();
  assert.strictEqual(typeof s.loggedIn, 'boolean');
  assert.strictEqual(typeof s.fresh, 'boolean');
  if (s.loggedIn) {
    assert.ok(/^\d{17}$/.test(s.steamId), 'steamID64 应为 17 位数字');
    assert.ok(s.at > 0);
  }
});

// ---- 官方筛选语义：组内「或」、组间「与」、空组不过滤 ----
test('筛选分组：空组 = 不过滤', () => {
  const r = workshop.expandTagGroups([]);
  assert.deepStrictEqual(r.combos, [[]]);
  assert.strictEqual(r.truncated, false);
});

test('筛选分组：组内多选展开成「或」', () => {
  const r = workshop.expandTagGroups([{ name: 'Genre', tags: ['Anime', 'Fantasy'] }]);
  assert.strictEqual(r.combos.length, 2);
  assert.deepStrictEqual(r.combos, [['Anime'], ['Fantasy']]);
});

test('筛选分组：组间是「与」（笛卡尔积）', () => {
  const r = workshop.expandTagGroups([
    { name: 'Genre', tags: ['Anime', 'Fantasy'] },
    { name: 'Type', tags: ['Video', 'Scene'] },
  ]);
  assert.strictEqual(r.combos.length, 4);
  assert.deepStrictEqual(r.combos, [
    ['Anime', 'Video'], ['Anime', 'Scene'], ['Fantasy', 'Video'], ['Fantasy', 'Scene'],
  ]);
});

test('筛选分组：去重 / 去空格 / 剔除已下线标签', () => {
  const r = workshop.expandTagGroups([{ name: 'Genre', tags: ['Anime', 'Anime', ' Fantasy '] }]);
  assert.deepStrictEqual(r.combos.map((c) => c[0]), ['Anime', 'Fantasy']);
  const r2 = workshop.expandTagGroups([{ name: 'Type', tags: ['Application', 'Video'] }]);
  assert.deepStrictEqual(r2.combos, [['Video']]);
});

test('筛选分组：组合过多退化为每组取第一个并标记 truncated', () => {
  const r = workshop.expandTagGroups([
    { name: 'A', tags: ['1', '2', '3'] },
    { name: 'B', tags: ['4', '5', '6'] },
  ]);
  assert.strictEqual(r.truncated, true);
  assert.deepStrictEqual(r.combos, [['1'], ['4']]);
});

console.log('\n[9] LZ4 块编解码');

test('LZ4 往返：随机数据 + 可压缩数据 + 空串', () => {
  const lz4 = require('../src/lz4');
  const random = Buffer.alloc(4096);
  for (let i = 0; i < random.length; i++) random[i] = (i * 7919 + (i >> 3)) & 0xff;
  const plain = Buffer.alloc(8192, 0x20); // 大片重复，保证能压
  for (const src of [Buffer.alloc(0), Buffer.from('a'), plain, random]) {
    const c = lz4.compress(src);
    if (src.length === 0) { assert.strictEqual(c.length, 0); continue; }
    const d = lz4.decompress(c, src.length);
    assert.deepStrictEqual(d, src);
  }
  assert.ok(lz4.compress(plain).length < plain.length / 4, '重复数据应显著压缩');
  assert.ok(lz4.compress(Buffer.alloc(1024, 1)).length < 64, '单色块应压得很小');
});

test('LZ4 解压会拒绝损坏的 offset', () => {
  const lz4 = require('../src/lz4');
  // token=0x00：0 字面量 + 匹配长度 4；随后 offset=0（非法）
  const bad = Buffer.from([0x00, 0x00, 0x00, 0x41]);
  assert.throws(() => lz4.decompress(bad, 8), /offset/);
});

console.log('\n[10] DXT 解码');

test('DXT1 纯色块 -> RGBA 精确还原', () => {
  const dxt = require('../src/dxt');
  // c0 = c1 = 0xF800 (纯红)，索引全 0 -> 调色板第 0 项
  const block = Buffer.alloc(8);
  block.writeUInt16LE(0xf800, 0);
  block.writeUInt16LE(0xf800, 2);
  block.writeUInt32LE(0, 4);
  const rgba = dxt.decode(block, 7, 4, 4);
  for (let i = 0; i < 16; i++) {
    assert.deepStrictEqual([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]], [255, 0, 0, 255]);
  }
  assert.strictEqual(dxt.payloadSize(7, 4, 4), 8);
  assert.strictEqual(dxt.payloadSize(7, 5, 3), 16); // 边缘块按 4x4 补齐
});

test('DXT5 显式 alpha 端点与 3bit 索引', () => {
  const dxt = require('../src/dxt');
  const block = Buffer.alloc(16);
  block[0] = 255; block[1] = 0;     // a0 > a1 -> 8 档插值
  block[2] = 0; block[3] = 0; block[4] = 0; block[5] = 0; block[6] = 0; block[7] = 0;
  block.writeUInt16LE(0x07e0, 8);   // 纯绿
  block.writeUInt16LE(0x07e0, 10);
  block.writeUInt32LE(0, 12);
  const rgba = dxt.decode(block, 4, 4, 4); // 4 号格式 = DXT5
  for (let i = 0; i < 16; i++) {
    assert.strictEqual(rgba[i * 4 + 1], 255, '绿色通道应为 255');
    assert.strictEqual(rgba[i * 4 + 3], 255, '索引 0 的 alpha 应为 a0');
  }
});

console.log('\n[11] 纹理路由与转换（2.0）');

const texlib = require('../src/tex');

/** 组装一个 TEX（默认移动端容器形态） */
function buildTex(opts) {
  const {
    format = texlib.TEX_FORMAT.DXT1, flags = 0,
    texW = 4, texH = 4, imgW = texW, imgH = texH,
    imageFormat = -1, videoMp4 = 0, container = 'TEXB0004',
    images = [],
  } = opts;
  const parts = [Buffer.from('TEXV0005\0'), Buffer.from('TEXI0001\0')];
  const head = Buffer.alloc(28);
  head.writeInt32LE(format, 0);
  head.writeInt32LE(flags, 4);
  head.writeInt32LE(texW, 8);
  head.writeInt32LE(texH, 12);
  head.writeInt32LE(imgW, 16);
  head.writeInt32LE(imgH, 20);
  head.writeUInt32LE(0, 24);
  parts.push(head, Buffer.from(container + '\0'));
  const ic = Buffer.alloc(4);
  ic.writeInt32LE(images.length, 0);
  parts.push(ic);
  if (container === 'TEXB0003' || container === 'TEXB0004') {
    const ifmt = Buffer.alloc(container === 'TEXB0004' ? 8 : 4);
    ifmt.writeInt32LE(imageFormat, 0);
    if (container === 'TEXB0004') ifmt.writeInt32LE(videoMp4, 4);
    parts.push(ifmt);
  }
  for (const img of images) {
    const mc = Buffer.alloc(4);
    mc.writeInt32LE(img.mips.length, 0);
    parts.push(mc);
    for (const m of img.mips) {
      const recLen = container === 'TEXB0001' ? 8 : 16;
      const rec = Buffer.alloc(recLen);
      rec.writeInt32LE(m.w, 0);
      rec.writeInt32LE(m.h, 4);
      if (recLen === 16) {
        rec.writeInt32LE(m.lz4 ? 1 : 0, 8);
        rec.writeInt32LE(m.decompressed || m.bytes.length, 12);
      }
      const len = Buffer.alloc(4);
      len.writeInt32LE(m.bytes.length, 0);
      parts.push(rec, len, m.bytes);
    }
  }
  return Buffer.concat(parts);
}

/** CRC32（PNG 分块用） */
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 生成一张纯色 RGBA PNG，用来模拟直通图纹理 */
function tinyPng(w, h, rgba = [0x30, 0x60, 0x90, 0xff]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) Buffer.from(rgba).copy(row, 1 + x * 4);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('DXT1 纹理会被转成移动端形态（RGBA8 + 单 mip）', () => {
  const block = Buffer.alloc(8);
  block.writeUInt16LE(0xf800, 0);
  block.writeUInt16LE(0xf800, 2);
  const src = buildTex({ images: [{ mips: [{ w: 4, h: 4, bytes: block }] }] });
  const r = texlib.convertTexBuffer(src, { relPath: 'materials/背景.tex' });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.route, 'convert-dxt');
  const out = texlib.parseTex(r.bytes);
  assert.strictEqual(out.header.format, texlib.TEX_FORMAT.RGBA8888);
  assert.strictEqual(out.container.imageFormat, texlib.FREE_IMAGE.UNKNOWN);
  assert.strictEqual(out.images[0].mips.length, 1);
  const mip = out.images[0].mips[0];
  const rgba = mip.lz4 ? require('../src/lz4').decompress(mip.bytes, mip.decompressedBytes) : mip.bytes;
  assert.strictEqual(rgba.length, 4 * 4 * 4);
  assert.strictEqual(rgba[0], 255);
  assert.strictEqual(rgba[1], 0);
  assert.ok(texlib.isMobileCompatible(out), '转换结果应通过移动端形态校验');
});

test('已是移动端形态的纹理原样保留（不重复压缩）', () => {
  const pixels = Buffer.alloc(4 * 4 * 4, 0x40);
  const src = buildTex({
    format: texlib.TEX_FORMAT.RGBA8888,
    images: [{ mips: [{ w: 4, h: 4, bytes: pixels, lz4: 0, decompressed: pixels.length }] }],
  });
  const r = texlib.convertTexBuffer(src, { relPath: 'a.tex' });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.route, 'keep-mobile');
});

test('超预算纹理保留原文件并给出理由', () => {
  const src = buildTex({ texW: 20000, texH: 20000, imgW: 20000, imgH: 20000, images: [{ mips: [{ w: 20000, h: 20000, bytes: Buffer.alloc(64) }] }] });
  const info = texlib.inspectTex(src, { maxRgbaBytes: 64 * 1024 * 1024 });
  assert.strictEqual(info.route, 'keep-budget');
  assert.ok(/预算/.test(info.reason));
  const r = texlib.convertTexBuffer(src, { maxRgbaBytes: 64 * 1024 * 1024 });
  assert.strictEqual(r.changed, false);
});

test('画质档位只对彩色图降采样，数据图保持原尺寸', () => {
  const preset = texlib.presetOf('balanced');
  const rawTex = () => buildTex({
    format: texlib.TEX_FORMAT.RGBA8888,
    container: 'TEXB0001',
    texW: 8, texH: 8, imgW: 8, imgH: 8,
    images: [{ mips: [{ w: 8, h: 8, bytes: Buffer.alloc(8 * 8 * 4, 0x20) }] }],
  });
  const color = texlib.convertTexBuffer(rawTex(), {
    relPath: 'materials/background_color.tex', preset, semantic: 'color',
  });
  // 8x8 缩小一半 -> 4x4
  assert.strictEqual(color.width, 4);
  assert.strictEqual(color.downsampled, true);
  const data = texlib.convertTexBuffer(rawTex(), {
    relPath: 'materials/normal_map.tex', preset, semantic: 'data',
  });
  assert.strictEqual(data.width, 8);
  assert.strictEqual(data.downsampled, false);
});

test('直通图逻辑尺寸大于载荷时按载荷缩放，不再报“裁剪尺寸大于原图”', () => {
  const src = buildTex({
    format: texlib.TEX_FORMAT.RGBA8888,
    texW: 8, texH: 8, imgW: 8, imgH: 8,
    imageFormat: texlib.FREE_IMAGE.PNG,
    images: [{ mips: [{ w: 4, h: 4, bytes: tinyPng(4, 4) }] }],
  });
  const r = texlib.convertTexBuffer(src, {
    relPath: 'materials/2k_earth_daymap.tex', preset: texlib.presetOf('balanced'), semantic: 'color', scale: 0.5,
  });
  assert.ok(r.changed, '应正常转换，而不是保留原文件');
  assert.strictEqual(r.width, 2, '4x4 载荷按 0.5 缩到 2x2');
  assert.strictEqual(r.height, 2);
});

test('同一目录里的纹理按整包统一倍率缩放（不会各缩各的）', () => {
  const dir = tmp('texscale');
  fs.mkdirSync(path.join(dir, 'materials'), { recursive: true });
  const raw = (w, h) => buildTex({
    format: texlib.TEX_FORMAT.RGBA8888,
    container: 'TEXB0001',
    texW: w, texH: h, imgW: w, imgH: h,
    images: [{ mips: [{ w, h, bytes: Buffer.alloc(w * h * 4, 0x40) }] }],
  });
  fs.writeFileSync(path.join(dir, 'materials', 'background.tex'), raw(16, 16));
  fs.writeFileSync(path.join(dir, 'materials', '1.tex'), raw(8, 8));
  fs.writeFileSync(path.join(dir, 'materials', 'normal_map.tex'), raw(8, 8));
  const res = texlib.convertTexDir(dir, { preset: 'balanced' });
  const w = (name) => texlib.parseTex(fs.readFileSync(path.join(dir, 'materials', name))).header.imageWidth;
  assert.strictEqual(w('background.tex'), 8, '16->8，倍率 0.5');
  assert.strictEqual(w('1.tex'), 4, '无名贴图也必须跟主图一起缩到 0.5');
  assert.strictEqual(w('normal_map.tex'), 8, '数据图不做有损缩放');
});

test('semanticOf 识别数据图 / 彩色图 / 未知', () => {
  assert.strictEqual(texlib.semanticOf('materials/normal_map.tex'), 'data');
  assert.strictEqual(texlib.semanticOf('materials/roughness.tex'), 'data');
  assert.strictEqual(texlib.semanticOf('materials/background_albedo.tex'), 'color');
  assert.strictEqual(texlib.semanticOf('materials/1.tex'), 'unknown');
});

test('纹理目录转换：统计与告警自洽', () => {
  const dir = tmp('texdir');
  fs.mkdirSync(path.join(dir, 'materials'), { recursive: true });
  const block = Buffer.alloc(8);
  block.writeUInt16LE(0xf800, 0);
  block.writeUInt16LE(0xf800, 2);
  fs.writeFileSync(path.join(dir, 'materials', 'a.tex'), buildTex({ images: [{ mips: [{ w: 4, h: 4, bytes: block }] }] }));
  fs.writeFileSync(path.join(dir, 'materials', 'broken.tex'), Buffer.from('not a tex'));
  const res = texlib.convertTexDir(dir, { onLog: () => {} });
  assert.strictEqual(res.stats.total, 2);
  assert.strictEqual(res.stats.converted, 1);
  assert.strictEqual(res.stats.failed, 1);
  assert.strictEqual(res.warnings.length, 1);
});

console.log('\n[12] 转换计划与断点');

test('buildPlan 记录资源清单，Checkpoint 能判重与落盘', () => {
  const cp = require('../src/convertplan');
  const dir = tmp('plan');
  fs.mkdirSync(path.join(dir, 'materials'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sound'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shaders'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'materials', 'a.tex'), buildTex({ images: [{ mips: [{ w: 4, h: 4, bytes: Buffer.alloc(8) }] }] }));
  fs.writeFileSync(path.join(dir, 'sound', 'bgm.mp3'), Buffer.alloc(10));
  fs.writeFileSync(path.join(dir, 'shaders', 'a.frag'), 'void main(){}');
  const plan = cp.buildPlan({ dir, preset: texlib.presetOf('high') });
  assert.strictEqual(plan.version, cp.PLAN_VERSION);
  assert.strictEqual(plan.resourceCount, 3);
  const kinds = plan.resources.map((r) => r.kind).sort();
  assert.deepStrictEqual(kinds, ['audio', 'shader', 'texture']);
  assert.ok(plan.resources.filter((r) => r.kind !== 'audio').every((r) => /^[0-9a-f]{64}$/.test(r.sha256)));

  const file = path.join(dir, 'cp.json');
  const checkpoint = new cp.Checkpoint(file);
  checkpoint.bind('high|v2');
  assert.strictEqual(checkpoint.isResolved('materials/a.tex', 'deadbeef'), false);
  checkpoint.record('materials/a.tex', 'in', 'out', 'convert-dxt');
  assert.strictEqual(checkpoint.isResolved('materials/a.tex', 'out'), true);
  assert.strictEqual(checkpoint.flush(), true);
  const reloaded = new cp.Checkpoint(file);
  assert.strictEqual(reloaded.loadedFromDisk, true);
  assert.strictEqual(reloaded.isResolved('materials/a.tex', 'out'), true);
  // 换档位后旧断点作废
  reloaded.bind('balanced|v2');
  assert.strictEqual(reloaded.isResolved('materials/a.tex', 'out'), false);
});

test('损坏的 checkpoint 按"无断点"处理而不是抛错', () => {
  const cp = require('../src/convertplan');
  const file = path.join(tmp('cp-bad'), 'cp.json');
  fs.writeFileSync(file, '{ this is not json');
  const c = new cp.Checkpoint(file);
  assert.strictEqual(c.loadedFromDisk, false);
  assert.strictEqual(c.isResolved('a', 'b'), false);
});

console.log('\n[13] 流式容器读取');

test('openPkg 与 parsePkg 结果一致，且按条目读取', () => {
  const entries = [
    { path: 'project.json', data: Buffer.from('{"type":"scene"}') },
    { path: 'materials/材质.json', data: Buffer.alloc(500, 3) },
  ];
  const dir = tmp('openpkg');
  const file = path.join(dir, 'a.mpkg');
  fs.writeFileSync(file, pkgformat.buildPkg(pkgformat.MAGIC_MOBILE, entries));
  const reader = pkgformat.openPkg(file);
  try {
    assert.strictEqual(reader.magic, pkgformat.MAGIC_MOBILE);
    assert.strictEqual(reader.entryCount, 2);
    assert.strictEqual(reader.entries[0].path, 'project.json');
    assert.deepStrictEqual(reader.readEntry(0), entries[0].data);
    assert.deepStrictEqual(reader.readEntry('materials/材质.json'), entries[1].data);
  } finally {
    reader.close();
  }
});

console.log('\n[14] 着色器结构性补丁');

const shader = require('../src/shadercompat');

test('sample 变量只在代码区改名，注释里不动', () => {
  const src = '// sample stays in comment\nvec4 sample = texture2D(t, uv);\nfloat x = 1;\n';
  const r = shader.rewriteAll(src, { relPath: 'materials/a.frag' });
  assert.ok(r.text.includes('vec4 _sample ='), '代码区的 sample 应改名');
  assert.ok(r.text.includes('// sample stays in comment'), '注释里的 sample 不应改');
  assert.ok(/float x = 1\.0;/i.test(r.text), '字面量补点仍然生效');
});

test('音频频谱打包下标被展开成一维索引', () => {
  const src = 'float a = g_AudioSpectrum64Left[i / 4][i % 4];';
  const r = shader.rewritePackedAudioSpectrum(src);
  assert.strictEqual(r.count, 1);
  assert.ok(r.text.includes('g_AudioSpectrum64Left[int(i)]'), r.text);
});

test('vec3 颜色累加器只在结构吻合时改写', () => {
  const ok = 'vec3 drawSence(float sence){\nvec4 col = vec4(0.,0.,0.,0.);\nreturn col;\n}';
  const r = shader.rewriteVec3ColorAccumulator(ok);
  assert.strictEqual(r.count, 1);
  assert.ok(r.text.includes('vec3 col = vec3(0.,0.,0.);'));
  const other = 'vec4 col = vec4(0.,0.,0.,0.);\n';
  assert.strictEqual(shader.rewriteVec3ColorAccumulator(other).count, 0);
});

test('xray 不再注入 g_PointerState（引擎自带，重复声明会编译失败）', () => {
  const src = 'varying vec2 v_PointerUV;\nvarying float v_PointerScale;\nvoid main(){ unprojectedUVs += 0.5; }';
  const r = shader.rewriteXray(src);
  assert.strictEqual(r.count, 0);
  assert.strictEqual(r.text, src);
});

test('预处理条件里的多余分号被去掉', () => {
  const src = '#if AUDIOSAMPLES == 16\nfloat a = 1;\n#elif AUDIOSAMPLES == 32;\nfloat a = 2;\n#endif\n';
  const r = shader.rewritePreprocessorCondition(src);
  assert.strictEqual(r.count, 1);
  assert.ok(r.text.includes('#elif AUDIOSAMPLES == 32\n'), r.text);
});

test('频谱 uniform 整数组拷贝展开成逐元素循环', () => {
  const src = '\tfloat left[AUDIOSAMPLES] = g_AudioSpectrum32Left;\n\tfloat l = left[i];\n';
  const r = shader.rewriteAudioSpectrumArray(src);
  assert.strictEqual(r.count, 1);
  assert.ok(!r.text.includes('float left[AUDIOSAMPLES] = g_AudioSpectrum32Left'), r.text);
  assert.ok(r.text.includes('float left[AUDIOSAMPLES];'), r.text);
  assert.ok(r.text.includes('float l = left[i];'), '使用处保持不动');
});

test('频谱动态下标改写成循环取值（移动端 GLSL ES 只接受常量下标）', () => {
  const src = [
    '\tfloat left[AUDIOSAMPLES];',
    '\tfloat right[AUDIOSAMPLES];',
    '\tfloat i = floor(v_TexCoord.x * len);',
    '\tfloat l = saturate(mix(left[i], right[i], 0.5));',
  ].join('\n') + '\n';
  const r = shader.rewriteDynamicArrayIndex(src);
  assert.strictEqual(r.count, 2, r.text);
  assert.ok(!/left\[i\]|right\[i\]/.test(r.text), r.text);
  assert.ok(r.text.includes('for (int _i'), r.text);
  assert.ok(r.text.includes('l = saturate(mix(left[_i'), r.text);
  assert.ok(shader.hasResidualDynamicArrayIndex(src), '原写法应被判为不可移植');
  assert.ok(!shader.hasResidualDynamicArrayIndex(r.text), '改写后不应再有动态下标');
});

test('常量下标 / 循环变量下标不动', () => {
  const src = '\tfloat arr[4];\n\tvec4 a = arr[3];\n\tfor (int k = 0; k < 4; k++) s += arr[k];\n';
  const r = shader.rewriteDynamicArrayIndex(src);
  assert.strictEqual(r.count, 0);
  assert.strictEqual(r.text, src);
});

test('赋值语句里的动态下标也能改写（不是声明就不能丢初值）', () => {
  const src = '\tfloat arr[4];\n\tvec4 albedo;\n\tfloat i = floor(u);\n\talbedo.rgb = mix(arr[i], vec3(0.), 0.5);\n';
  const r = shader.rewriteDynamicArrayIndex(src);
  assert.strictEqual(r.count, 1, r.text);
  assert.ok(r.text.includes('albedo.rgb = mix(arr[_i'), r.text);
});

test('引擎注入的指针/视差 uniform 重复声明被去掉（互动效果的编译杀手）', () => {
  const src = 'uniform vec4 g_PointerState;\nuniform vec4 g_ParallaxPosition;\nvoid main(){ vec2 p = g_PointerState.xy; }\n';
  const r = shader.rewriteEngineUniformDecl(src);
  assert.strictEqual(r.count, 2, r.text);
  assert.ok(!r.text.includes('uniform vec4 g_PointerState'), r.text);
  assert.ok(r.text.includes('g_PointerState.xy'), '用法必须保留');
});

test('CRLF 文件里的 `* 2.0 - 1` 也补成 1.0（行尾 \\r 曾让改写静默失效）', () => {
  const src = '\tvec3 n1 = texSample2D(g_Texture2, rippleCoords.xy).xyz * 2.0 - 1;\r\n\tvec3 n2 = 2.0 - 1;\r\n';
  const r = shader.rewriteAll(src, { relPath: 'shaders/effects/a.frag' });
  assert.strictEqual(r.literalsChanged, 2, r.text);
  assert.ok(r.text.includes('* 2.0 - 1.0;'), r.text);
  assert.ok(/\r\n/.test(r.text), '换行风格保持 CRLF');
});

test('整数表达式塞进 float 变量时包一层 float()', () => {
  const src = 'const int sampleCount = 50;\nconst float sampleDrop = sampleCount - 1;\n';
  const r = shader.rewriteIntFloatMix(src);
  assert.strictEqual(r.count, 1, r.text);
  assert.ok(r.text.includes('const float sampleDrop = float(sampleCount - 1);'), r.text);
});

test('int / float 混型运算给 int 那侧套 float()', () => {
  const src = 'for (int i = 0; i < n; ++i) { x += (i / drop); }\n';
  const r = shader.rewriteIntFloatMix(src);
  assert.strictEqual(r.count, 1, r.text);
  assert.ok(r.text.includes('(float(i) / drop)'), r.text);
});

test('重复改写是幂等的（否则复检会把 float() 套两层变成 floatfloat）', () => {
  const src = '\tfloat gap = u_gap / (100 * AUDIOSAMPLES);\r\n\tfloat left[AUDIOSAMPLES] = g_AudioSpectrum32Left;\r\n';
  const once = shader.rewriteAll(src, { relPath: 'x.frag' }).text;
  const twice = shader.rewriteAll(once, { relPath: 'x.frag' }).text;
  assert.strictEqual(twice, once);
  assert.ok(!/floatfloat/.test(twice), twice);
});

console.log('\n[15] 图层兼容（音频频谱 / 叠加层 / 互动）与音频剥离');

/** 造一个最小工程：带音频频谱层 + 子层 + 重叠属性 */
function makeLayerProject(name, shaderBody) {
  const dir = tmp(name);
  fs.mkdirSync(path.join(dir, 'effects', 'bar'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'effects', 'plain'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shaders', 'effects'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'shaders', 'effects', 'bar.frag'), shaderBody);
  fs.writeFileSync(path.join(dir, 'shaders', 'effects', 'plain.frag'), 'void main(){}\n');
  fs.writeFileSync(path.join(dir, 'effects', 'bar', 'effect.json'), JSON.stringify({ dependencies: ['shaders/effects/bar.frag'] }));
  fs.writeFileSync(path.join(dir, 'effects', 'plain', 'effect.json'), JSON.stringify({ dependencies: ['shaders/effects/plain.frag'] }));
  fs.mkdirSync(path.join(dir, 'sound'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sound', 'bgm.mp3'), Buffer.alloc(64));
  return dir;
}

test('音频频谱层：shader 可移植时保留（不再直接删掉）', () => {
  const dir = makeLayerProject('keepAudioLayer', 'uniform float g_AudioSpectrum32Left[32];\nvoid main(){}\n');
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({
    objects: [
      { id: 386, name: '纯色', image: 'models/util/solidlayer.json', effects: [{ file: 'effects/bar/effect.json' }] },
      { id: 2, name: '普通纯色', image: 'models/util/solidlayer.json', effects: [{ file: 'effects/plain/effect.json' }] },
    ],
  }));
  const r = packer.repairSceneCompat(dir, {});
  assert.strictEqual(r.removed.length, 0);
  assert.strictEqual(r.kept.length, 1);
  assert.strictEqual(r.warnings.length, 0);
  const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8'));
  assert.deepStrictEqual(scene.objects.map((o) => o.id), [386, 2]);
});

test('音频频谱层：shader 改写后仍不可移植时才移除，并把子层重挂到祖父层', () => {
  const dir = makeLayerProject('dropAudioLayer', 'uniform float g_AudioSpectrum32Left[32];\n\tfloat arr[AUDIOSAMPLES];\n\tfloat i = floor(u);\n\tfloat l = arr[i];\n');
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({
    objects: [
      { id: 113, name: '容器', solid: true },
      { id: 386, name: '纯色', parent: 113, image: 'models/util/solidlayer.json', effects: [{ file: 'effects/bar/effect.json' }] },
      { id: 114, name: 'Year 年', parent: 386 },
    ],
  }));
  const r = packer.repairSceneCompat(dir, {});
  assert.strictEqual(r.removed.length, 1);
  assert.ok(r.warnings[0].includes('纯色'), r.warnings[0]);
  const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8'));
  assert.deepStrictEqual(scene.objects.map((o) => o.id), [113, 114]);
  assert.strictEqual(scene.objects.find((o) => o.id === 114).parent, 113, '子层要重挂到祖父层，不能变孤儿');
});

test('叠加层：alpha 字符串归一为数字，孤儿父级断开', () => {
  const dir = tmp('overlay');
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({
    objects: [
      { id: 1, name: '底图' },
      { id: 2, name: '叠加', alpha: '0.35', parent: 99, multiply: '1 1 1' },
    ],
  }));
  const r = packer.repairSceneCompat(dir, {});
  const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8'));
  assert.strictEqual(scene.objects[1].alpha, 0.35);
  assert.strictEqual(scene.objects[1].parent, undefined);
  assert.strictEqual(scene.objects[1].multiply, '1 1 1', '叠加属性必须原样保留');
  assert.deepStrictEqual(r.repaired.map((x) => x.action).sort(), ['alpha-numeric', 'orphan-parent-dropped']);
});

test('--drop-audio-layers 可强制移除音频频谱层', () => {
  const dir = makeLayerProject('forceDrop', 'uniform float g_AudioSpectrum32Left[32];\nvoid main(){}\n');
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({
    objects: [{ id: 386, name: '纯色', image: 'models/util/solidlayer.json', effects: [{ file: 'effects/bar/effect.json' }] }],
  }));
  const r = packer.repairSceneCompat(dir, { dropAudioLayers: true });
  assert.strictEqual(r.removed.length, 1);
  assert.ok(r.removed[0].reason.includes('手动'));
});

test('场景用到音频频谱时默认保留音频（否则监听器收不到数据）', () => {
  const dir = makeLayerProject('audioKeep', 'uniform float g_AudioSpectrum32Left[32];\nvoid main(){}\n');
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({
    objects: [{ id: 1, image: 'models/util/solidlayer.json', effects: [{ file: 'effects/bar/effect.json' }] }],
  }));
  assert.ok(packer.sceneUsesAudioSpectrum(dir));
  const kept = packer.stripAudio(dir, {});
  assert.strictEqual(kept.removed, 0);
  assert.strictEqual(kept.keptForAudioReactive, true);
  assert.ok(fs.existsSync(path.join(dir, 'sound', 'bgm.mp3')));

  const dir2 = makeLayerProject('audioStrip', 'void main(){}\n');
  fs.writeFileSync(path.join(dir2, 'scene.json'), JSON.stringify({
    objects: [{ id: 1, effects: [{ file: 'effects/plain/effect.json' }] }],
  }));
  const removed = packer.stripAudio(dir2, {});
  assert.strictEqual(removed.removed, 1);
});

test('默认剥离音频，preserveAudio 时保留', () => {
  const dir = tmp('audio');
  fs.mkdirSync(path.join(dir, 'sound'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sound', 'bgm.mp3'), Buffer.alloc(64));
  fs.writeFileSync(path.join(dir, 'scene.json'), '{}');
  const removed = packer.stripAudio(dir, {});
  assert.strictEqual(removed.removed, 1);
  assert.strictEqual(removed.bytes, 64);
  assert.ok(!fs.existsSync(path.join(dir, 'sound', 'bgm.mp3')));

  const dir2 = tmp('audio2');
  fs.mkdirSync(path.join(dir2, 'sound'), { recursive: true });
  fs.writeFileSync(path.join(dir2, 'sound', 'bgm.mp3'), Buffer.alloc(64));
  const kept = packer.stripAudio(dir2, { preserveAudio: true });
  assert.strictEqual(kept.removed, 0);
  assert.ok(fs.existsSync(path.join(dir2, 'sound', 'bgm.mp3')));
});

(async () => {
  console.log('\n[16] 下载中心：队列 / 并发 / 断点');

const dlhub = require('../src/dlhub');

/** 造一个可手动控制完成时机的假 runner */
function deferredRunner() {
  const calls = [];
  let started = 0;
  const runner = (job, hooks) => {
    started++;
    let resolve;
    let reject;
    const p = new Promise((res, rej) => { resolve = res; reject = rej; });
    calls.push({ job, hooks, resolve, reject, started });
    return p;
  };
  return { runner, calls, get started() { return started; } };
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

await testAsync('并发上限 3：第 4 条任务排队，前一条结束后自动补位', async () => {
  const d = deferredRunner();
  const hub = dlhub.createHub({ runner: d.runner, file: path.join(tmp('hub1'), 'state.json'), maxConcurrent: 3 });
  const ids = [1, 2, 3, 4, 5].map((i) => hub.add({ id: String(i), title: `t${i}` }).id);
  await sleepMs(10);
  assert.strictEqual(hub.stats().running, 3, '只应有 3 条在跑');
  assert.strictEqual(hub.stats().queued, 2);
  d.calls[0].resolve({ result: { outFile: '/tmp/a.mpkg', size: 1, type: 'scene' } });
  await sleepMs(20);
  assert.strictEqual(hub.stats().running, 3, '空出一个位置应立刻补上第 4 条');
  assert.strictEqual(hub.get(ids[0]).state, 'done');
  for (const c of d.calls) c.resolve({ result: {} });
  await sleepMs(30);
  hub.stop();
});

await testAsync('进度：下载阶段按字节算百分比，速度/ETA 随之更新', async () => {
  const d = deferredRunner();
  const hub = dlhub.createHub({ runner: d.runner, file: path.join(tmp('hub2'), 'state.json'), maxConcurrent: 3 });
  const job = hub.add({ id: '77' });
  await sleepMs(10);
  d.calls[0].hooks.onProgress({ phase: 'download', percent: 25, bytes: 25, total: 100, detail: '下载 a.png' });
  assert.strictEqual(job.progress.percent, 25);
  assert.strictEqual(job.progress.bytes, 25);
  assert.strictEqual(job.progress.total, 100);
  assert.strictEqual(job.progress.detail, '下载 a.png');
  d.calls[0].hooks.onProgress({ phase: 'convert', done: 2, total: 4 });
  assert.strictEqual(job.progress.percent, 50, '转换阶段按 done/total 折算');
  d.calls[0].resolve({ result: {} });
  await sleepMs(20);
  assert.strictEqual(hub.get(job.id).state, 'done');
  assert.strictEqual(hub.get(job.id).progress.percent, 100);
  hub.stop();
});

await testAsync('取消：排队的立即取消，运行中的在阶段边界停', async () => {
  const d = deferredRunner();
  const hub = dlhub.createHub({ runner: d.runner, file: path.join(tmp('hub3'), 'state.json'), maxConcurrent: 1 });
  const j1 = hub.add({ id: '1' });
  const j2 = hub.add({ id: '2' });
  await sleepMs(10);
  assert.strictEqual(hub.cancel(j2.id), true);
  assert.strictEqual(j2.state, 'cancelled');
  assert.strictEqual(hub.cancel(j1.id), true);
  assert.strictEqual(d.calls[0].hooks.isCancelled(), true, '运行中的任务应看到取消标记');
  d.calls[0].reject(new (require('../src/packjob').CancelledError)());
  await sleepMs(20);
  assert.strictEqual(j1.state, 'cancelled');
  hub.stop();
});

await testAsync('失败后重试会重新排队', async () => {
  const d = deferredRunner();
  const hub = dlhub.createHub({ runner: d.runner, file: path.join(tmp('hub4'), 'state.json'), maxConcurrent: 3 });
  const job = hub.add({ id: '9' });
  await sleepMs(10);
  d.calls[0].reject(new Error('网络断了'));
  await sleepMs(20);
  assert.strictEqual(job.state, 'failed');
  assert.match(job.error, /网络断了/);
  const again = hub.retry(job.id);
  assert.strictEqual(again.state, 'queued');
  await sleepMs(20);
  assert.strictEqual(d.calls.length, 2, '重试应产生第二次执行');
  d.calls[1].resolve({ result: {} });
  await sleepMs(20);
  assert.strictEqual(job.state, 'done');
  hub.stop();
});

await testAsync('队列落盘：重启后未完成任务重新排队、完成记录保留', async () => {
  const dir = tmp('hub5');
  const file = path.join(dir, 'state.json');
  const d = deferredRunner();
  const hub = dlhub.createHub({ runner: d.runner, file, maxConcurrent: 3 });
  const a = hub.add({ id: '11', title: '完成过的' });
  await sleepMs(10);
  d.calls[0].resolve({ result: { outFile: '/tmp/x.mpkg', size: 12, type: 'scene' } });
  await sleepMs(20);
  const b = hub.add({ id: '12', title: '跑到一半' });
  await sleepMs(10);
  hub.persistNow();
  hub.stop();

  const d2 = deferredRunner();
  const hub2 = dlhub.createHub({ runner: d2.runner, file, maxConcurrent: 3 });
  assert.strictEqual(hub2.get(a.id).state, 'done', '完成的记录应保留');
  assert.strictEqual(hub2.get(b.id).state, 'queued', '中断的任务应重新排队');
  await sleepMs(20);
  assert.strictEqual(d2.calls.length, 1, '重启后自动续跑');
  d2.calls[0].resolve({ result: {} });
  await sleepMs(10);
  hub2.stop();
});

await testAsync('历史超过 20 条会裁剪，运行中也能 forget（先取消再删记录）', async () => {
  let n = 0;
  const fastRunner = () => Promise.resolve({ result: { outFile: `/tmp/x${++n}.mpkg`, size: 1, type: 'scene' } });
  const hub = dlhub.createHub({ runner: fastRunner, file: path.join(tmp('hub6'), 'state.json'), maxConcurrent: 3 });
  for (let i = 0; i < 27; i++) hub.add({ id: `h${i}` });
  await sleepMs(200);
  assert.ok(hub.list().length <= 23, `历史应被裁剪到 20 条左右，实际 ${hub.list().length}`);
  const doneId = hub.list().find((j) => j.state === 'done').id;
  assert.strictEqual(hub.forget(doneId), true, '已完成任务可移除');
  const queued = hub.add({ id: 'still-running' });
  assert.strictEqual(hub.forget(queued.id), true, '排队中的也应能移除');
  assert.strictEqual(hub.get(queued.id), null, '移除后记录立刻消失');
  assert.strictEqual(queued.cancelRequested, true, '移除排队任务要同时发取消信号');
  hub.stop();
});

await testAsync('暂停 / 继续：只在下载中生效，暂停可被取消打断', async () => {
  const d = deferredRunner();
  const hub = dlhub.createHub({ runner: d.runner, file: path.join(tmp('hub6b'), 'state.json'), maxConcurrent: 3 });
  const job = hub.add({ id: 'p1' });
  await sleepMs(10);
  assert.strictEqual(job.state, 'downloading');
  assert.strictEqual(hub.pause(job.id), true);
  assert.strictEqual(job.paused, true);
  assert.strictEqual(hub.view(job).paused, true, '接口返回要带 paused');
  assert.strictEqual(d.calls[0].hooks.isPaused(), true, 'runner 应能看到暂停标记');
  assert.strictEqual(hub.resume(job.id), true);
  assert.strictEqual(job.paused, false);
  assert.strictEqual(d.calls[0].hooks.isPaused(), false);
  assert.strictEqual(hub.pause(job.id), true, '再次暂停');
  assert.strictEqual(hub.cancel(job.id), true);
  assert.strictEqual(job.paused, false, '取消要清掉暂停，否则分块循环卡在等待里');
  d.calls[0].reject(new (require('../src/packjob').CancelledError)());
  await sleepMs(20);
  assert.strictEqual(job.state, 'cancelled');
  // 已结束的不能再暂停
  assert.strictEqual(hub.pause(job.id), false);
  hub.stop();
});

await testAsync('暂停成功后结束：不能把「已暂停」留在 done 卡片上', async () => {
  const d = deferredRunner();
  const hub = dlhub.createHub({ runner: d.runner, file: path.join(tmp('hub6c'), 'state.json'), maxConcurrent: 3 });
  const job = hub.add({ id: 'p2' });
  await sleepMs(10);
  hub.pause(job.id);
  assert.strictEqual(job.paused, true);
  // 暂停在最后几个分块时，任务仍可能跑完
  d.calls[0].resolve({ result: { outFile: '/tmp/p2.mpkg', size: 1, type: 'scene' } });
  await sleepMs(20);
  assert.strictEqual(job.state, 'done');
  assert.strictEqual(job.paused, false, '完成的任务必须清掉暂停标记');
  assert.strictEqual(hub.view(job).paused, false);
  hub.stop();
});

await testAsync('暂停中失败 → 重试不应继承暂停（否则一进下载就卡住）', async () => {
  const d = deferredRunner();
  const hub = dlhub.createHub({ runner: d.runner, file: path.join(tmp('hub6d'), 'state.json'), maxConcurrent: 3 });
  const job = hub.add({ id: 'p3' });
  await sleepMs(10);
  hub.pause(job.id);
  d.calls[0].reject(new Error('网络断了'));
  await sleepMs(20);
  assert.strictEqual(job.state, 'failed');
  assert.strictEqual(job.paused, false, '失败时也要清掉暂停标记');
  const again = hub.retry(job.id);
  assert.strictEqual(again.paused, false, '重试必须从非暂停状态开始');
  await sleepMs(20);
  assert.strictEqual(d.calls.length, 2);
  d.calls[1].resolve({ result: {} });
  await sleepMs(20);
  assert.strictEqual(job.state, 'done');
  hub.stop();
});

await testAsync('移除运行中任务：立刻从列表消失，但记录等停下来才删；同条目重下会被拒', async () => {
  const d = deferredRunner();
  const hub = dlhub.createHub({ runner: d.runner, file: path.join(tmp('hub6e'), 'state.json'), maxConcurrent: 3 });
  const job = hub.add({ id: 'same-item' });
  await sleepMs(10);
  assert.strictEqual(job.state, 'downloading');
  assert.strictEqual(hub.forget(job.id), true);
  assert.strictEqual(hub.list().some((j) => j.id === job.id), false, '列表里应立刻看不到');
  assert.ok(hub.get(job.id), '记录要留到 runner 真正退出');
  assert.strictEqual(job.cancelRequested, true);
  assert.throws(() => hub.add({ id: 'same-item' }), /已有任务在跑/, '同条目不能并发写同一个下载目录');
  d.calls[0].reject(new (require('../src/packjob').CancelledError)());
  await sleepMs(30);
  assert.strictEqual(hub.get(job.id), null, '停止后记录应自动删掉');
  // 现在可以重新下了
  const again = hub.add({ id: 'same-item' });
  assert.ok(again.id);
  hub.stop();
});

await testAsync('HTTP 接口：创建 / 列表 / 取消 / 文件', async () => {
  const http = require('http');
  const d = deferredRunner();
  const hub = dlhub.createHub({ runner: d.runner, file: path.join(tmp('hub7'), 'state.json'), maxConcurrent: 3 });
  const server = dlhub.createServer({ hub, port: 0 });
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;

  const req = (method, p, body) => new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {} }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* ignore */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });

  const ping = await req('GET', '/api/hub/ping');
  assert.strictEqual(ping.status, 200);
  assert.strictEqual(ping.json.maxConcurrent, 3);

  const created = await req('POST', '/api/hub/jobs', { id: '300', title: '接口测试' });
  assert.strictEqual(created.status, 200);
  const jobId = created.json.jobId;

  const list = await req('GET', '/api/hub/jobs');
  assert.strictEqual(list.json.jobs.length, 1);
  assert.strictEqual(list.json.jobs[0].title, '接口测试');

  const one = await req('GET', `/api/hub/jobs/${jobId}`);
  assert.strictEqual(one.status, 200);
  assert.strictEqual(one.json.itemId, '300');

  const pause = await req('POST', `/api/hub/jobs/${jobId}/pause`);
  assert.strictEqual(pause.status, 200, '运行中的任务应能暂停');
  const resumed = await req('POST', `/api/hub/jobs/${jobId}/resume`);
  assert.strictEqual(resumed.status, 200, '暂停中的任务应能继续');

  const cancel = await req('POST', `/api/hub/jobs/${jobId}/cancel`);
  assert.strictEqual(cancel.status, 200);

  const missing = await req('GET', '/api/hub/jobs/d999');
  assert.strictEqual(missing.status, 404);

  // 文件接口：伪造一个已完成任务
  const fdir = tmp('hubfile');
  fs.mkdirSync(fdir, { recursive: true });
  const outFile = path.join(fdir, 'x.mpkg');
  fs.writeFileSync(outFile, Buffer.from('mpkg-bytes'));
  const j = hub.add({ id: '301' });
  j.state = 'done';
  j.result = { outFile, size: 10, type: 'scene' };
  const file = await req('GET', `/api/hub/file/${j.id}`);
  assert.strictEqual(file.status, 200);
  assert.strictEqual(file.text, 'mpkg-bytes');

  // 安卓端「导入壁纸引擎」要靠绝对路径：列表接口必须带 outPath
  const jobsList = await req('GET', '/api/hub/jobs');
  const listed = (JSON.parse(jobsList.text).jobs || []).find((x) => x.id === j.id);
  assert.ok(listed, '列表里应能看到该任务');
  assert.strictEqual(listed.outPath, outFile, '列表必须返回成品绝对路径 outPath');
  assert.strictEqual(listed.outFile, 'x.mpkg', 'outFile 仍只给文件名');
  // 详情抽屉读的是 result.outPath（不是顶层），两个地方都要给
  assert.strictEqual(listed.result && listed.result.outPath, outFile, 'result 里也要带绝对路径');

  server.close();
  hub.stop();
});

await testAsync('ensureHub：已有 hub 时直接复用（不重复拉起进程）', async () => {
  const d = deferredRunner();
  const hub = dlhub.createHub({ runner: d.runner, file: path.join(tmp('hub8'), 'state.json'), maxConcurrent: 3 });
  const server = dlhub.createServer({ hub, port: 0 });
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const info = await dlhub.pingHub(port, 2000);
  assert.ok(info && info.ok, 'ping 应返回 ok');
  assert.strictEqual(info.embedded, undefined);
  server.close();
  hub.stop();
});

  await testAsync('整条流水线：工坊目录 -> mpkg（async）', async () => {    const itemDir = makeItemDir();
    const outDir = tmp('out2');
    const res = await packer.packFromItemDir(itemDir, { id: '999', title: 'Async', outDir, onLog: () => {} });
    assert.ok(fs.existsSync(res.outFile));
  });
  await testAsync('打包接入档位 / 计划 / 音频 / 视频 magic（2.0）', async () => {
    const itemDir = makeItemDir();
    const outDir = tmp('out2v');
    const logs = [];
    const res = await packer.packFromItemDir(itemDir, {
      id: '1000',
      title: 'V2',
      outDir,
      preset: 'smooth',
      videoMagic: '0014',
      onLog: (l) => logs.push(l),
    });
    assert.ok(fs.existsSync(res.outFile));
    assert.strictEqual(res.preset.id, 'smooth');
    assert.strictEqual(res.magic, pkgformat.MAGIC_MOBILE); // 类型不是 video，仍用 0020
    assert.ok(res.tex && typeof res.tex.converted === 'number');
    assert.ok(res.shader && typeof res.shader.total === 'number');
    assert.ok(res.audio && typeof res.audio.removed === 'number');
    assert.ok(res.plan && res.plan.resourceCount > 0, '应返回转换计划摘要');
    assert.strictEqual(res.plan.preset.id, 'smooth');
    assert.strictEqual(res.planFile, null, '不续转时不保留工作目录，planFile 应为 null');
    // 续转时保留工作目录并把计划/断点落盘
    const keep = await packer.packFromItemDir(makeItemDir(), {
      id: '1001', title: 'V2Resume', outDir: tmp('out2r'), resume: true, onLog: () => {},
    });
    assert.ok(fs.existsSync(keep.planFile), '续转时应写出转换计划');
    assert.ok(fs.existsSync(keep.checkpointFile), '续转时应写出断点文件');
    const planDisk = JSON.parse(fs.readFileSync(keep.planFile, 'utf8'));
    assert.strictEqual(planDisk.version, 2);
    assert.ok(planDisk.resources.length > 0);
    // 视频类型 + 显式指定时用 0014
    assert.strictEqual(packer.pickMagic('video', '0014'), pkgformat.MAGIC_MOBILE_VIDEO);
    assert.strictEqual(packer.pickMagic('video'), pkgformat.MAGIC_MOBILE);
    assert.strictEqual(packer.pickMagic('scene', '0014'), pkgformat.MAGIC_MOBILE);
  });

  await testAsync('打包各阶段会推进度事件（prepare → inspect → convert → shader → write → done）', async () => {
    const itemDir = makeItemDir();
    const phases = [];
    const convertInfo = [];
    const res = await packer.packFromItemDir(itemDir, {
      id: '1002', title: 'Progress', outDir: tmp('out2p'),
      onLog: () => {},
      onProgress: (p) => {
        if (!phases.includes(p.phase)) phases.push(p.phase);
        if (p.phase === 'convert' && p.total) convertInfo.push([p.done, p.total]);
      },
    });
    assert.ok(fs.existsSync(res.outFile));
    assert.deepStrictEqual(phases, ['prepare', 'inspect', 'convert', 'shader', 'write', 'done']);
    assert.ok(convertInfo.length >= 2, '转换阶段应收到达标/总数');
    assert.strictEqual(convertInfo[0][0], 0, '转换从 0 开始');
  });

  await testAsync('未知容器输入会报错', async () => {    const f = path.join(tmp('bad'), 'x.pkg');
    fs.writeFileSync(f, Buffer.from('not a pkg at all'));
    await assert.rejects(() => packer.packFromPath(f, { onLog: () => {} }), /magic|长度/);
  });

  console.log('\n[17] CDN 节点分类 / 排序 / 失败换点');
  const cdn = require('../src/cdn');

  test('主机名分类：阿里、Edgenext、Akamai、Fastly、就近集群', () => {
    const ali = cdn.classifyHost('alibaba.cdn.steampipe.steamcontent.com');
    assert.strictEqual(ali.provider, 'alibaba');
    assert.strictEqual(ali.domestic, true, '阿里 CDN 应视为国内节点');
    const edge = cdn.classifyHost('edgenext.cdn.steampipe.steamcontent.com');
    assert.strictEqual(edge.domestic, true);
    const hkg = cdn.classifyHost('cache10-hkg1.steamcontent.com');
    assert.strictEqual(hkg.cluster, 'hkg');
    assert.strictEqual(hkg.region, 'hk');
    assert.strictEqual(hkg.domestic, false);
    const tpe = cdn.classifyHost('cache3-tpe-hnet.steamcontent.com');
    assert.strictEqual(tpe.cluster, 'tpe');
    const fastly = cdn.classifyHost('fastly.cdn.steampipe.steamcontent.com');
    assert.strictEqual(fastly.provider, 'fastly');
    const akamai = cdn.classifyHost('steampipe.akamaized.net');
    assert.strictEqual(akamai.provider, 'akamai');
  });

  test('国内客户端的地域优先级：国内 > 港台 > 日新韩 > 远端', () => {
    const mk = (host) => ({ Host: host });
    assert.strictEqual(cdn.tierOf(mk('alibaba.cdn.steampipe.steamcontent.com'), 'CN'), 0);
    assert.strictEqual(cdn.tierOf(mk('cache10-hkg1.steamcontent.com'), 'CN'), 1);
    assert.strictEqual(cdn.tierOf(mk('cache3-tpe-hnet.steamcontent.com'), 'CN'), 1);
    assert.strictEqual(cdn.tierOf(mk('cache8-tyo3.steamcontent.com'), 'CN'), 2);
    assert.strictEqual(cdn.tierOf(mk('fastly.cdn.steampipe.steamcontent.com'), 'CN'), 3);
    // 海外客户端：本国集群优先，国内节点不再加分
    assert.strictEqual(cdn.tierOf(mk('cache5-lax1.steamcontent.com'), 'US'), 0);
    assert.ok(cdn.tierOf(mk('alibaba.cdn.steampipe.steamcontent.com'), 'US') > 0);
  });

  test('排序：同 tier 比延迟，慢太多会被更近的节点压过，失败垫底', () => {
    const results = [
      { server: { Host: 'alibaba.cdn.steampipe.steamcontent.com' }, ok: true, latencyMs: 9000 },
      { server: { Host: 'cache10-hkg1.steamcontent.com' }, ok: true, latencyMs: 600 },
      { server: { Host: 'fastly.cdn.steampipe.steamcontent.com' }, ok: false, error: 'timeout' },
    ];
    const ranked = cdn.rankResults(results, 'CN');
    assert.strictEqual(ranked[ranked.length - 1].host, 'fastly.cdn.steampipe.steamcontent.com', '失败节点排最后');
    assert.strictEqual(ranked[0].host, 'cache10-hkg1.steamcontent.com', '9 秒的国内节点不该压过 0.6 秒的香港节点');
    // 国内节点足够快时优先
    const ranked2 = cdn.rankResults([
      { server: { Host: 'alibaba.cdn.steampipe.steamcontent.com' }, ok: true, latencyMs: 300 },
      { server: { Host: 'cache10-hkg1.steamcontent.com' }, ok: true, latencyMs: 600 },
    ], 'CN');
    assert.strictEqual(ranked2[0].host, 'alibaba.cdn.steampipe.steamcontent.com');
  });

  test('失败换点：按排序依次换，全部失败后自动重置再来一轮', () => {
    const a = { Host: 'a' };
    const b = { Host: 'b' };
    const picker = new cdn.ServerPicker([a, b]);
    assert.strictEqual(picker.next(), a);
    picker.fail(a);
    assert.strictEqual(picker.next(), b, 'a 失败后应换 b');
    picker.fail(b);
    assert.strictEqual(picker.alive().length, 0);
    const again = picker.next();
    assert.ok(again === a || again === b, '全部判死后要能重置再试');
    assert.strictEqual(picker.rounds, 1);
  });

  console.log('\n[17b] 下载引擎：只剩纯 JS（SteamCMD 已移除）');
  test('activeEngine 固定 steamjs，旧的 WE_MPKG_ENGINE=steamcmd 不再生效', () => {
    const packjob = require('../src/packjob');
    const had = Object.prototype.hasOwnProperty.call(process.env, 'WE_MPKG_ENGINE');
    const old = process.env.WE_MPKG_ENGINE;
    process.env.WE_MPKG_ENGINE = 'steamcmd';
    try {
      assert.strictEqual(packjob.activeEngine(), 'steamjs');
    } finally {
      if (had) process.env.WE_MPKG_ENGINE = old;
      else delete process.env.WE_MPKG_ENGINE;
    }
  });

  console.log('\n[18] 视频纹理识别 / 重封装');

  // 造一个桌面版视频纹理：TEXB0004 + imageFormat=-1 + videoMp4=0 + flags=34，mip 载荷是 MP4
  const mp4Stub = Buffer.from('000000186674797069736F6D0000020069736F6D6D703431', 'hex');
  const makeVideoTex = (w, h) => tex.buildVideoTex({ format: 0, flags: 34, unk: 0, width: w, height: h, mp4: mp4Stub });

  test('4K 视频纹理被判为需转码（不是 raw 像素）', () => {
    const info = tex.inspectTex(makeVideoTex(3840, 2160));
    assert.strictEqual(info.route, 'video-texture-shrink');
    assert.strictEqual(info.width, 3840);
    assert.ok(!/原始像素/.test(info.reason));
  });

  test('1080p 视频纹理原样保留，不改写任何字节', () => {
    const buf = makeVideoTex(1920, 1080);
    const info = tex.inspectTex(buf);
    assert.strictEqual(info.route, 'video-texture');
    const r = tex.convertTexBuffer(buf, { preset: 'high' });
    assert.strictEqual(r.changed, false);
    assert.strictEqual(r.route, 'video-texture');
  });

  test('视频纹理重封装后能被解析回同一个 MP4 载荷', () => {
    const buf = makeVideoTex(1920, 1080);
    const t = tex.parseTex(buf);
    const v = tex.videoPayload(t);
    assert.ok(v, '应识别出视频载荷');
    assert.strictEqual(v.data.length, mp4Stub.length);
    assert.ok(v.data.equals(mp4Stub));
    assert.strictEqual(t.header.flags & tex.TEX_FLAGS.IsVideoTexture, 32, 'IsVideoTexture 位要保留');
  });

  test('普通像素纹理转换后必须清掉 IsVideoTexture 位（否则手机端按视频纹理找流，整块黑）', () => {
    const w = 4, h = 4;
    const mips = [
      { width: w, height: h, lz4: 0, decompressedBytes: 0, bytes: Buffer.alloc(w * h * 4, 0x80) },
      { width: 2, height: 2, lz4: 0, decompressedBytes: 0, bytes: Buffer.alloc(2 * 2 * 4, 0x80) },
    ];
    const parts = [
      sstr('TEXV0005'), sstr('TEXI0001'),
      i32Buf(tex.TEX_FORMAT.RGBA8888), i32Buf(34), i32Buf(w), i32Buf(h), i32Buf(w), i32Buf(h), i32Buf(0),
      sstr('TEXB0004'), i32Buf(1), i32Buf(tex.FREE_IMAGE.UNKNOWN), i32Buf(0), i32Buf(mips.length),
    ];
    for (const m of mips) {
      parts.push(i32Buf(m.width), i32Buf(m.height), i32Buf(0), i32Buf(0), i32Buf(m.bytes.length), m.bytes);
    }
    const src = Buffer.concat(parts);
    const r = tex.convertTexBuffer(src, { relPath: 'materials/bg.tex', preset: 'high' });
    assert.ok(r.changed, '多 mip 的原始像素纹理应被转换');
    const out = tex.parseTex(r.bytes);
    assert.strictEqual(out.header.flags & tex.TEX_FLAGS.IsVideoTexture, 0, '输出不应保留 IsVideoTexture');
    assert.strictEqual(out.header.flags & tex.TEX_FLAGS.ClampUVs, 2, 'ClampUVs 等无关标志要保留');
  });

  console.log('\n[19] 桌面下载中心：保存 .mpkg 的链接');
  test('主页面浮层的保存链接必须走主服务 /api/file/<id>', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', 'public', 'dlcenter.js'), 'utf8');
    assert.ok(s.includes('href="/api/file/'), '应该指向主服务转发接口');
    assert.ok(!s.includes('href="api/hub/file/'), '不能再用下载中心端口上的相对路径（在主页面会 404）');
  });

  console.log('\n[20] 代理设置 / 错误人话');
  test('代理字符串规范化：补 scheme、拒绝 socks', () => {
    const config = require('../src/config');
    assert.strictEqual(config.normalizeProxy('127.0.0.1:7890'), 'http://127.0.0.1:7890');
    assert.strictEqual(config.normalizeProxy(''), '');
    assert.throws(() => config.normalizeProxy('socks5://127.0.0.1:1080'), /只支持 http/);
  });
  test('net.js 导出 testProxy，且不再导出写死的 PROXY', () => {
    const net = require('../src/net');
    assert.strictEqual(typeof net.testProxy, 'function');
    assert.strictEqual(typeof net.currentProxy, 'function');
    assert.strictEqual(net.PROXY, undefined);
  });
  test('EResult 15/85/88 映射成人话', () => {
    const errors = require('../src/errors');
    assert.match(errors.humanizeMessage('EResult 15'), /没有访问权限/);
    assert.match(errors.humanizeMessage('EResult 85'), /账号或密码错误/);
    assert.match(errors.humanizeMessage('EResult 88'), /Steam Guard 验证码错误/);
    assert.match(errors.humanizeMessage('ECONNREFUSED 127.0.0.1:7890'), /测试连通性/);
    assert.strictEqual(errors.eresultOf('eresult: 84'), 84);
  });
  test('设置页必须有代理输入 / 测试按钮，后端有 /api/proxy/test', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.ok(html.includes('id="proxyInput"'));
    assert.ok(html.includes('id="testProxy"'));
    const srv = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    assert.ok(srv.includes("'/api/proxy/test'"));
    assert.ok(srv.includes('configMod.setProxy'));
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.ok(js.includes('async function testProxyConn'));
  });

  console.log('\n[21] 凭据加密');
  test('securestore 写入后文件不含明文，读回来一致', () => {
    const securestore = require('../src/securestore');
    const f = path.join(os.tmpdir(), `we-mpkg-secret-${Date.now()}.json`);
    securestore.writeJson(f, { refreshToken: 'SECRET-TOKEN-XYZ', accountName: '测试账号' });
    const raw = fs.readFileSync(f, 'utf8');
    assert.ok(raw.includes('__we_mpkg_enc'), '应该是加密信封');
    assert.ok(!raw.includes('SECRET-TOKEN-XYZ'), '不能以明文出现');
    assert.deepStrictEqual(securestore.readJson(f), { refreshToken: 'SECRET-TOKEN-XYZ', accountName: '测试账号' });
    fs.unlinkSync(f);
  });

  console.log('\n[22] P1：批量下载 / 兼容性报告 / 设备推荐 / 自动更新 / CI');
  test('兼容性报告：application 判 bad，空 scene 判 warn', () => {
    const compat = require('../src/compat');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'we-compat-'));
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ type: 'application', title: 'x' }));
    const a = compat.inspect(dir, { type: 'application' });
    assert.strictEqual(a.level, 'bad');
    assert.ok(a.warnings.some((w) => /application/.test(w)));
    const b = compat.inspect(dir, { type: 'scene' });
    assert.strictEqual(b.level, 'warn');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test('版本比较与更新检查（离线只验比较逻辑）', () => {
    const u = require('../src/update');
    assert.strictEqual(u.compare('2.2.0', '2.1.2'), 1);
    assert.strictEqual(u.compare('v2.1.2', '2.1.2'), 0);
    assert.strictEqual(u.compare('2.0.9', '2.1.0'), -1);
    assert.match(u.currentVersion(), /^\d+\.\d+\.\d+$/);
  });
  test('前端有批量下载、兼容性块、设备推荐与更新入口', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    for (const id of ['batchBar', 'batchStart', 'd-compat', 'd-device', 'checkUpdate']) {
      assert.ok(html.includes(`id="${id}"`), `缺少 #${id}`);
    }
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.ok(js.includes('async function startBatch'));
    assert.ok(js.includes('function renderCompat'));
    assert.ok(js.includes('function detectDevice'));
    assert.ok(js.includes('async function checkUpdate'));
    assert.ok(js.includes("d.release.assets.apk"), '安卓应使用 APK 资产直链');
    assert.ok(js.includes('openExternal(link.href)'), 'APK 直链应交给系统浏览器打开');
  });
  test('GitHub Actions 打 tag 自动构建 portable/APK 并发布', () => {
    const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
    assert.match(wf, /tags:\s*\n\s*- 'v\*'/);
    assert.ok(wf.includes('build-portable.ps1'));
    assert.ok(wf.includes('assembleRelease'));
    assert.ok(wf.includes('softprops/action-gh-release'));
    assert.ok(!wf.includes('pwpwsh'), 'shell 拼写错误会让任务直接失败');
  });

  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
  if (failed) {
    for (const f of failures) console.error(`\n失败: ${f.name}\n${f.error.stack}`);
    process.exitCode = 1;
  }
})();

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  ✘ ${name}\n      ${e.message}`);
  }
}

