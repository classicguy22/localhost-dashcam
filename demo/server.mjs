import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.DASHCAM_DEMO_PORT || 4173);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/checkout.js', ['checkout.js', 'text/javascript; charset=utf-8']],
  ['/demo.css', ['demo.css', 'text/css; charset=utf-8']]
]);
createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  if (pathname === '/api/checkout' && request.method === 'POST') {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Payment service unavailable' }));
    return;
  }
  const file = files.get(pathname);
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': file[1] }).end(content);
  } catch {
    response.writeHead(500).end();
  }
}).listen(port, '127.0.0.1', () => console.log('Checkout demo: http://127.0.0.1:' + port));
