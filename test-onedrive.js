const http = require('http');

const data = JSON.stringify({
  shareUrl: 'https://1drv.ms/w/c/dbe893591bc61ebd/IQC9HsYbWZPoIIDbTwIAAAAAAarLMPdRl-OFuzETFVSJCuQ?e=kArT6G'
});

const req = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/api/onedrive-sync/start',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  },
  timeout: 120000
}, (res) => {
  let body = '';
  res.on('data', (d) => body += d);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch (e) {
      console.log('Response:', body);
    }
  });
});

req.on('error', (e) => {
  console.error('Request Error:', e.message);
});

req.on('timeout', () => {
  console.error('Request timed out');
  req.destroy();
});

req.write(data);
req.end();

console.log('Request sent, waiting for response...');
