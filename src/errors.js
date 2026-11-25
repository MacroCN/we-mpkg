/**
 * 把 Steam / 网络抛出来的技术报错翻成人话。
 * 输入可能是 Error，也可能只是字符串；输出的字符串前面保留 EResult 编号，方便查文档。
 */

const ERESULT_TEXT = {
  2: 'Steam 返回「失败」（EResult 2），稍后重试',
  3: '账号不存在或凭据无效（EResult 3）',
  5: '请求参数无效（EResult 5），先确认条目 ID 与 AppID',
  6: 'Steam 服务端暂时不可用（EResult 6），等几分钟再试',
  7: '账号未登录或登录状态已失效（EResult 7），重新登录',
  8: '请求无效（EResult 8），检查账号是否有权访问该内容',
  9: '文件/内容不存在（EResult 9），条目可能已下架',
  15: '没有访问权限（EResult 15）：这个账号没买 Wallpaper Engine（AppID 431960），或该内容被区域/成人分级限制',
  16: '账号被限制（EResult 16），去 Steam 客服页看限制原因',
  17: '账号被限制（EResult 17），去 Steam 客服页看限制原因',
  20: '需要先登录（EResult 20）',
  21: '登录凭据已过期（EResult 21），重新登录',
  24: '登录凭据已过期（EResult 24），重新登录',
  25: '账号被限制（EResult 25），去 Steam 客服页看限制原因',
  27: '已经登录过（EResult 27）',
  28: '登录被拒绝（EResult 28），检查账号密码',
  29: '登录被拒绝（EResult 29），检查账号密码',
  36: '登录状态已失效（EResult 36），重新登录',
  40: '该内容不在你的账号库里（EResult 40），先确认账号已拥有它',
  50: '账号被封禁（EResult 50），无法下载',
  51: '账号被封禁（EResult 51），无法下载',
  53: '账号被限制（EResult 53），无法下载',
  55: '账号未登录（EResult 55），重新登录',
  63: '账号已被 Steam 限制（EResult 63），常见原因是退款/风控，去 Steam 客服页申诉',
  65: '登录凭据已过期（EResult 65），重新登录',
  84: '请求太频繁（EResult 84），等几分钟再试',
  85: '账号或密码错误（EResult 85），检查后重试',
  88: 'Steam Guard 验证码错误（EResult 88），重新输入',
  93: '请求太频繁（EResult 93），等几分钟再试',
  101: '请求太频繁（EResult 101），等几分钟再试',
  105: 'Steam 服务暂时不可用（EResult 105），稍后重试',
  108: '登录被拒绝（EResult 108），检查账号密码',
  112: '内容服务器拒绝请求（EResult 112），检查账号是否有权访问该内容',
  118: '内容服务器拒绝请求（EResult 118），检查账号是否有权访问该内容',
  128: '请求太频繁（EResult 128），等几分钟再试',
};

const TEXT_HINTS = [
  [/Access Denied|access denied|EResult 15|eresult.?15/i, ERESULT_TEXT[15]],
  [/InvalidPassword|invalid password|密码错误/i, ERESULT_TEXT[85]],
  [/TwoFactorCodeMismatch|guard code mismatch|验证码错误/i, ERESULT_TEXT[88]],
  [/Not Logged On|not logged on|LoggedInElsewhere|已失效|登录态/i, ERESULT_TEXT[7]],
  [/RateLimit|rate limit|too many|请求太频繁|429/i, ERESULT_TEXT[84]],
  [/\b(?:ban|banned)\b|封禁/i, ERESULT_TEXT[50]],
  [/ENOENT|no such file/i, '文件不存在，可能是内容已下架或缓存被清理'],
];

function rawText(e) {
  if (!e) return '';
  if (typeof e === 'string') return e;
  return (e && e.message) || String(e);
}

function eresultOf(text) {
  const m = text.match(/E[Rr]esult[^0-9]{0,4}(\d{1,3})/);
  if (m) return Number(m[1]);
  const m2 = text.match(/eresult[^0-9]{0,4}(\d{1,3})/i);
  return m2 ? Number(m2[1]) : null;
}

/** 把 Error/字符串变成一句人话（保留 EResult 编号） */
function humanizeMessage(e) {
  const orig = rawText(e).trim();
  if (!orig) return '未知错误';
  const code = eresultOf(orig);
  if (code && ERESULT_TEXT[code]) return ERESULT_TEXT[code];
  for (const [re, msg] of TEXT_HINTS) {
    if (re.test(orig)) return msg;
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(orig)) {
    return `连不上 Steam 服务器（${orig}）：检查代理/网络，或在设置页点「测试连通性」`;
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(orig)) {
    return `请求超时（${orig}）：网络不稳或 CDN 节点慢，重试或换代理`;
  }
  return orig;
}

/** 同上，但返回 Error，保留 cause 方便日志排查 */
function humanize(e) {
  const message = humanizeMessage(e);
  const err = new Error(message);
  err.cause = e;
  return err;
}

module.exports = { humanize, humanizeMessage, eresultOf, ERESULT_TEXT };
