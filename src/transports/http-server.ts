import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Hub } from '../core/hub.ts';
import { PROTOCOL_VERSION, SERVER_NAME, type ServerMessage } from '../core/protocol.ts';
import type { AppConfig } from '../config.ts';
import type { LogBuffer, Logger } from '../lib/log.ts';
import { buildDiagnostics, diagnosticsFileName } from './diagnostics.ts';
import { VERSION } from '../version.ts';
import { feedOptionsFromUrl, openFeed } from './feed.ts';
import { hostHeaderAllowed, originAllowed, tokenAllowed } from './security.ts';
import { statusPageHtml } from './status-page.ts';

export interface HttpServerOptions {
  hub: Hub;
  host: string;
  allowedOrigins: readonly string[];
  /** Extra Host names (reverse proxy) accepted while listening on loopback. */
  allowedHosts?: readonly string[];
  /** PEM certificate and key: serve HTTPS / WSS instead of HTTP / WS. */
  tls?: { cert: Buffer; key: Buffer };
  token?: string;
  motionMaxHz: number;
  log: Logger;
  /** Enables `/v1/diagnostics`. */
  diagnostics?: { config: AppConfig; logBuffer: LogBuffer; startedAt: number };
}

const HEARTBEAT_MS = 15_000;
/** Above this many queued bytes a client is slow: motion messages are skipped for it. */
const SLOW_CLIENT_BYTES = 256 * 1024;

/**
 * Routes:
 *   GET /            status page for the streamer (no secrets)
 *   GET /health      liveness
 *   GET /v1/state    every source's status and last fix
 *   GET /v1/stream   Server-Sent Events (fallback)
 *   WS  /v1/ws       WebSocket (main channel)
 * Query on stream/ws: `source=<id|auto>`, `motion=1`, `token=<token>` when one is configured.
 */
export function createHttpServer(options: HttpServerOptions): { server: http.Server | https.Server; closeClients: () => void } {
  const { hub, log } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const sseClients = new Set<ServerResponse>();

  /** CORS only for allowed origins: a refused site must not even learn that the server exists. */
  const corsHeaders = (req: IncomingMessage): Record<string, string> => {
    const origin = req.headers.origin;
    if (!origin || !originAllowed(origin, options.allowedOrigins)) return {};
    return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  };

  /** Shared gate for HTTP and WebSocket. Returns an HTTP status + reason when refused. */
  const gate = (req: IncomingMessage, url: URL, needsToken: boolean): [number, string] | undefined => {
    if (!hostHeaderAllowed(req.headers.host, options.host, options.allowedHosts)) return [421, 'unexpected Host header'];
    if (!originAllowed(req.headers.origin, options.allowedOrigins)) {
      return [403, `origin ${req.headers.origin} is not in allowedOrigins`];
    }
    if (needsToken && !tokenAllowed(req, url, options.token)) return [401, 'missing or wrong token'];
    return undefined;
  };

  const sendJson = (req: IncomingMessage, res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(req),
    });
    res.end(JSON.stringify(body));
  };

  const state = () => ({
    server: SERVER_NAME,
    version: VERSION,
    protocol: PROTOCOL_VERSION,
    activeSource: hub.activeGpsSource ?? null,
    sources: hub.snapshots(),
  });

  const serveSse = (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const feedOptions = feedOptionsFromUrl(url, hub, options.motionMaxHz);
    if (typeof feedOptions === 'string') return sendJson(req, res, 404, { error: feedOptions });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(req),
    });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    const send = (msg: ServerMessage) => res.write(`event: ${msg.type}\ndata: ${JSON.stringify(msg)}\n\n`);
    const close = openFeed(hub, feedOptions, send, () => res.writableLength < SLOW_CLIENT_BYTES);
    const ping = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    const cleanup = () => {
      clearInterval(ping);
      close();
      sseClients.delete(res);
    };
    req.on('close', cleanup);
    res.on('error', cleanup);
    log.info(`overlay connected via SSE (${req.headers.origin ?? 'no origin'}, source=${feedOptions.subscription})`);
  };

  const handler: http.RequestListener = (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const isPage = url.pathname === '/' || url.pathname === '/health';
    const refused = gate(req, url, !isPage);
    if (refused) {
      log.debug(`refused ${req.method} ${url.pathname}: ${refused[1]}`);
      return sendJson(req, res, refused[0], { error: refused[1] });
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders(req),
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'Authorization',
        // Old Private Network Access preflight; harmless where Local Network Access replaced it.
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(req, res, 405, { error: 'method not allowed' });

    switch (url.pathname) {
      case '/':
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
        });
        return res.end(statusPageHtml());
      case '/health':
        // Cheap "is the server up?" check for overlays and scripts (no location data).
        return sendJson(req, res, 200, {
          ok: true,
          server: SERVER_NAME,
          version: VERSION,
          protocol: PROTOCOL_VERSION,
          sources: hub.snapshots().map((s) => ({ id: s.id, driver: s.driver, link: s.status.link, gps: s.status.gps })),
        });
      case '/v1/state':
        return sendJson(req, res, 200, state());
      case '/v1/stream':
        return serveSse(req, res, url);
      case '/v1/diagnostics': {
        if (!options.diagnostics) return sendJson(req, res, 404, { error: 'not found' });
        const keepPositions = ['1', 'true', 'yes'].includes(url.searchParams.get('positions') ?? '');
        const body = buildDiagnostics({ hub, ...options.diagnostics, keepPositions });
        log.info(`diagnostics downloaded (positions ${keepPositions ? 'included' : 'masked'})`);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${diagnosticsFileName()}"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          ...corsHeaders(req),
        });
        return res.end(JSON.stringify(body, null, 2));
      }
      default:
        return sendJson(req, res, 404, { error: 'not found' });
    }
  };

  const server = options.tls ? https.createServer({ cert: options.tls.cert, key: options.tls.key }, handler) : http.createServer(handler);

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const reject = (status: number, reason: string) => {
      log.warn(`refused an overlay connection: ${reason}`);
      socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? ''}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    if (url.pathname !== '/v1/ws') return reject(404, `no websocket at ${url.pathname}`);
    const refused = gate(req, url, true);
    if (refused) return reject(...refused);
    const feedOptions = feedOptionsFromUrl(url, hub, options.motionMaxHz);
    if (typeof feedOptions === 'string') return reject(404, feedOptions);

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      let alive = true;
      ws.on('pong', () => (alive = true));
      const send = (msg: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      };
      const close = openFeed(hub, feedOptions, send, () => ws.bufferedAmount < SLOW_CLIENT_BYTES);
      const heartbeat = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, HEARTBEAT_MS);
      ws.on('close', () => {
        clearInterval(heartbeat);
        close();
        log.info(`overlay disconnected (${req.headers.origin ?? 'no origin'})`);
      });
      ws.on('error', (err) => log.debug(`websocket error: ${err.message}`));
      // Clients have nothing to say yet; messages are ignored (reserved for future commands).
      log.info(`overlay connected (${req.headers.origin ?? 'no origin'}, source=${feedOptions.subscription})`);
    });
  });

  const closeClients = () => {
    for (const ws of wss.clients) ws.terminate();
    for (const res of sseClients) res.end();
    sseClients.clear();
    wss.close();
  };

  return { server, closeClients };
}
