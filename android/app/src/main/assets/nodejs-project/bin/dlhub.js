'use strict';
/**
 * 下载中心独立进程入口。
 *   node bin/dlhub.js [--port 3091]
 * 一般不用手动起：主服务会在创建下载任务时按需拉起。
 */
const dlhub = require('../src/dlhub');

function parseArgs(argv) {
  const out = { port: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') { out.port = parseInt(argv[++i], 10); continue; }
    if (a.startsWith('--port=')) { out.port = parseInt(a.slice(7), 10); continue; }
    if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('用法: node bin/dlhub.js [--port 3091]\n  独立进程运行下载中心（网页端口默认 3091）');
  process.exit(0);
}

const port = dlhub.DEFAULT_PORT && args.port ? args.port : (args.port || dlhub.DEFAULT_PORT);
const log = (m) => console.log(`[dlhub] ${m}`);

const hub = dlhub.createHub({ logger: log });
const server = dlhub.createServer({
  hub,
  port,
  onShutdown: () => {
    try { server.close(); } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 200);
  },
});

server.on('listening', () => {
  log(`下载中心已启动: http://127.0.0.1:${port}  (pid ${process.pid}, 并发上限 ${hub.maxConcurrent})`);
  const st = hub.stats();
  if (st.total) log(`载入队列 ${st.total} 条：运行 ${st.running} / 排队 ${st.queued} / 完成 ${st.done} / 失败 ${st.failed}`);
});
server.on('error', (e) => {
  log(`端口 ${port} 启动失败: ${e.message}（可用 WE_MPKG_DLHUB_PORT 或 --port 换端口）`);
  process.exit(1);
});

let closing = false;
function shutdown(sig) {
  if (closing) return;
  closing = true;
  log(`收到 ${sig}，保存队列后退出`);
  try { hub.stop(); } catch { /* ignore */ }
  try { require('../src/packjob').resetSharedClient(); } catch { /* ignore */ }
  try { server.close(); } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
