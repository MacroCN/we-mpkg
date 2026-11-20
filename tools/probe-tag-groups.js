'use strict';
/** 离线分析：从保存的创意工坊落地页 SSR 里提取官方 tag 分组（看看 Application 是否还在） */
const fs = require('fs');
const html = fs.readFileSync(process.argv[2] || 'logs/debug/ws.html', 'utf8');
const m = html.match(/<script[^>]*id="valve-ssr-data"[^>]*>([\s\S]*?)<\/script>/i);
if (!m) { console.log('没有 valve-ssr-data'); process.exit(0); }
const data = JSON.parse(m[1]);
let qd = data.renderContext && data.renderContext.queryData;
if (typeof qd === 'string') qd = JSON.parse(qd);
console.log('queries:', (qd.queries || []).length);
for (const q of qd.queries || []) {
  const d = q.state && q.state.data;
  if (d && Array.isArray(d.readytouse_tags) && d.readytouse_tags.length) {
    console.log('url:', q.url || d.url || '');
    console.log('total:', d.total_count || d.total || '', 'numperpage:', d.numperpage || '');
    for (const g of d.readytouse_tags) {
      console.log(`  [${g.name}] elem=${g.htmlelement}`);
      console.log('    ' + g.tags.map((t) => `${t.name}#${t.id}`).join(', '));
    }
    // 其它可能的分组
    for (const k of Object.keys(d)) {
      if (/filter|tag|type|rating/i.test(k) && !['readytouse_tags'].includes(k)) {
        const v = d[k];
        if (Array.isArray(v)) console.log('  ', k, '=>', JSON.stringify(v).slice(0, 300));
      }
    }
  }
}
