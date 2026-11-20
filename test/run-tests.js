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

const pkgformat = require('../src/pkgformat');
const packer = require('../src/pack');
const workshop = require('../src/workshop');

let passed = 0;
let failed = 0;
const failures = [];

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

(async () => {
  await testAsync('整条流水线：工坊目录 -> mpkg（async）', async () => {
    const itemDir = makeItemDir();
    const outDir = tmp('out2');
    const res = await packer.packFromItemDir(itemDir, { id: '999', title: 'Async', outDir, onLog: () => {} });
    assert.ok(fs.existsSync(res.outFile));
  });
  await testAsync('未知容器输入会报错', async () => {
    const f = path.join(tmp('bad'), 'x.pkg');
    fs.writeFileSync(f, Buffer.from('not a pkg at all'));
    await assert.rejects(() => packer.packFromPath(f, { onLog: () => {} }), /magic|长度/);
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

