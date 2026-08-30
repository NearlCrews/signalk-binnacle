// A Signal K stream fixture for the browser tests. Playwright's routeWebSocket cannot reach the
// app's delta stream because the WebSocket opens inside the Comlink worker and the dispatcher is
// frame-bound, so the mariner specs run against this real server instead: it serves the built app,
// answers /signalk/v1/stream with a hello and scripted deltas, and exposes an HTTP control channel
// the spec drives mid-test. REST endpoints stay page.route stubs in the specs, matching the rest of
// the e2e suite.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import process from 'node:process';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.SIGNALK_FIXTURE_PORT ?? 4174);
const BASE_PATH = '/signalk-binnacle/';
const STREAM_PATH = '/signalk/v1/stream';
const CONTROL_PREFIX = '/__fixture__/';
const STATIC_ROOT = resolve('public');
const MAX_CONTROL_BODY_BYTES = 1_048_576;
const DEFAULT_SELF = 'vessels.urn:mrn:signalk:uuid:c0d79334-4e25-4245-8892-54e8ccc8021d';

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.css', 'text/css'],
  ['.json', 'application/json'],
  ['.map', 'application/json'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.webmanifest', 'application/manifest+json'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
]);

/** @type {Set<import('ws').WebSocket>} */
const streamClients = new Set();
/** @type {unknown[]} */
const receivedMessages = [];
let helloSelf = DEFAULT_SELF;
let streamsEnabled = true;

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(payload);
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<unknown>}
 */
async function readJsonBody(request) {
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = /** @type {Buffer} */ (chunk);
    total += buffer.length;
    if (total > MAX_CONTROL_BODY_BYTES) throw new Error('control body too large');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length === 0 ? undefined : JSON.parse(text);
}

/** @param {unknown} payload */
function broadcast(payload) {
  const frame = JSON.stringify(payload);
  for (const client of streamClients) client.send(frame);
  return streamClients.size;
}

function helloFrame() {
  return {
    name: 'signalk-fixture',
    version: '2.14.0',
    self: helloSelf,
    roles: ['master', 'main'],
    timestamp: new Date().toISOString(),
  };
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {string} pathname
 */
async function handleControl(request, response, pathname) {
  const action = pathname.slice(CONTROL_PREFIX.length);
  try {
    if (request.method === 'GET' && action === 'state') {
      sendJson(response, 200, {
        connections: streamClients.size,
        received: receivedMessages,
        self: helloSelf,
      });
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'POST required' });
      return;
    }
    const body = await readJsonBody(request);
    switch (action) {
      case 'delta': {
        const deltas = Array.isArray(body) ? body : [body];
        let delivered = 0;
        for (const delta of deltas) delivered = broadcast(delta);
        sendJson(response, 200, { delivered });
        return;
      }
      case 'hello': {
        const self =
          typeof body === 'object' && body !== null && 'self' in body ? body.self : undefined;
        if (typeof self === 'string' && self.length > 0) helloSelf = self;
        sendJson(response, 200, { self: helloSelf });
        return;
      }
      case 'close-streams': {
        streamsEnabled = false;
        for (const client of streamClients) client.terminate();
        sendJson(response, 200, { closed: true });
        return;
      }
      case 'reset': {
        receivedMessages.length = 0;
        helloSelf = DEFAULT_SELF;
        streamsEnabled = true;
        sendJson(response, 200, { reset: true });
        return;
      }
      default:
        sendJson(response, 404, { error: `unknown control action: ${action}` });
        return;
    }
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : 'bad request' });
  }
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {string} pathname
 */
async function handleStatic(response, pathname) {
  const relative = pathname.slice(BASE_PATH.length);
  const target = resolve(STATIC_ROOT, relative === '' ? 'index.html' : relative);
  if (target !== STATIC_ROOT && !target.startsWith(STATIC_ROOT + sep)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const file = await readFile(target);
    response.writeHead(200, {
      'content-type': CONTENT_TYPES.get(extname(target)) ?? 'application/octet-stream',
    });
    response.end(file);
  } catch {
    // The single-page fallback, matching how the Signal K server serves the webapp route.
    const index = await readFile(resolve(STATIC_ROOT, 'index.html'));
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(index);
  }
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', `http://localhost:${PORT}`).pathname;
  if (pathname.startsWith(CONTROL_PREFIX)) {
    void handleControl(request, response, pathname);
    return;
  }
  if (pathname === '/' || pathname === '/signalk-binnacle') {
    response.writeHead(302, { location: BASE_PATH });
    response.end();
    return;
  }
  if (pathname.startsWith(BASE_PATH)) {
    void handleStatic(response, pathname).catch(() => {
      response.writeHead(500);
      response.end();
    });
    return;
  }
  response.writeHead(404);
  response.end();
});

const streams = new WebSocketServer({ noServer: true });

streams.on('connection', (socket) => {
  streamClients.add(socket);
  socket.send(JSON.stringify(helloFrame()));
  socket.on('message', (data) => {
    try {
      receivedMessages.push(JSON.parse(String(data)));
    } catch {
      receivedMessages.push({ unparsed: String(data) });
    }
  });
  socket.on('close', () => streamClients.delete(socket));
});

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url ?? '/', `http://localhost:${PORT}`).pathname;
  if (pathname !== STREAM_PATH || !streamsEnabled) {
    socket.destroy();
    return;
  }
  streams.handleUpgrade(request, socket, head, (client) => {
    streams.emit('connection', client, request);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`signalk fixture serving ${STATIC_ROOT} on http://127.0.0.1:${PORT}${BASE_PATH}`);
});
