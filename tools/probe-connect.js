const http = require('http');
const net = require('net');
const tls = require('tls');

// 代理地址从 WE_MPKG_PROXY 读，默认本地 7890（不要在这里写死内网地址）
const rawProxy = process.env.WE_MPKG_PROXY || 'http://127.0.0.1:7890';
const u = new URL(/^\w+:\/\//.test(rawProxy) ? rawProxy : 'http://' + rawProxy);
const proxy = { host: u.hostname, port: Number(u.port || 7890) };
const target = { host: 'steamcommunity.com', port: 443 };

const req = http.request({
  hostname: proxy.host,
  port: proxy.port,
  method: 'CONNECT',
  path: `${target.host}:${target.port}`,
});
req.setTimeout(15000, () => {
  console.log('CONNECT timeout');
  req.destroy();
});
req.on('error', (e) => console.log('CONNECT error:', e.code, e.message));
req.on('connect', (res, socket) => {
  console.log('CONNECT status', res.statusCode);
  if (res.statusCode !== 200) {
    socket.destroy();
    return;
  }
  const secure = tls.connect({ socket, servername: target.host }, () => {
    console.log('TLS ok, alpn=', secure.alpnProtocol, 'cipher=', secure.getCipher().name);
    secure.end();
  });
  secure.on('error', (e) => console.log('TLS error:', e.code, e.message));
});
req.end();

