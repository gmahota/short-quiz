import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';

const PORT = Number(process.env.PORT || 3000);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const rooms = new Map(); // Tudo reside exclusivamente na RAM deste processo.
const ROOM_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_ROOMS = 100;
const MAX_RESPONSES = 800;
const MAX_CLIENTS = 1200;
const MAX_ANSWER_LENGTH = 65;

function randomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from(crypto.randomBytes(6), b => letters[b % letters.length]).join(''); }
  while (rooms.has(code));
  return code;
}
function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(JSON.stringify(data));
}
function fail(res, status, message) { json(res, status, { error: message }); }
async function readBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 8000) throw new Error('Pedido demasiado grande.');
  }
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error('JSON inválido.'); }
}
function cleanInput(input, max) {
  return String(input ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}
function normalize(value) {
  return value.toLocaleLowerCase('pt').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function state(room) {
  const grouped = new Map();
  for (const answer of room.answers.values()) {
    if (!grouped.has(answer.key)) grouped.set(answer.key, { key: answer.key, text: answer.text, count: 0 });
    grouped.get(answer.key).count++;
  }
  return {
    type: 'state', code: room.code, question: room.question,
    version: room.version, total: room.answers.size,
    answers: [...grouped.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'pt'))
  };
}
function sendEvent(res, obj) {
  try { res.write(`data: ${JSON.stringify(obj)}\n\n`); return true; }
  catch { return false; }
}
function broadcast(room) {
  const snapshot = state(room);
  for (const res of room.listeners) if (!sendEvent(res, snapshot)) room.listeners.delete(res);
}
function closeRoom(room) {
  for (const res of room.listeners) {
    sendEvent(res, { type: 'closed' });
    try { res.end(); } catch {}
  }
  room.listeners.clear();
  room.answers.clear(); room.blocked.clear();
  room.question = ''; room.token = '';
  rooms.delete(room.code);
}
function isAdmin(req, room) {
  const header = req.headers['x-admin-token'];
  if (typeof header !== 'string' || !/^[a-f0-9]{64}$/.test(header)) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(room.token));
}
function requestOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}
function touch(room) { room.updatedAt = Date.now(); }

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml; charset=utf-8'
};
async function serveFile(res, name) {
  try {
    const content = await readFile(path.join(root, name));
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(name)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'"
    });
    res.end(content);
  } catch { fail(res, 404, 'Ficheiro não encontrado.'); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    if (req.method === 'GET' && route === '/health') return json(res, 200, { status: 'ok', rooms: rooms.size });
    if (req.method === 'POST' && route === '/api/rooms') {
      if (rooms.size >= MAX_ROOMS) return fail(res, 429, 'Limite de salas temporárias atingido.');
      const code = randomCode();
      const token = crypto.randomBytes(32).toString('hex');
      rooms.set(code, {
        code, token, question: '', version: 0,
        answers: new Map(), blocked: new Set(), listeners: new Set(), updatedAt: Date.now(),
        rate: new Map()
      });
      return json(res, 201, { code, adminUrl: `/admin/${code}/${token}`, joinUrl: `/join/${code}`, screenUrl: `/screen/${code}` });
    }
    const match = route.match(/^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})(?:\/(events|qr|question|vote|remove|clear|reset))?$/);
    if (match) {
      const [, code, action] = match;
      const room = rooms.get(code);
      if (!room) return fail(res, 404, 'Sala inexistente ou já encerrada.');
      if (Date.now() - room.updatedAt > ROOM_TTL_MS) {
        closeRoom(room);
        return fail(res, 410, 'Sala expirada. Cria uma nova sala.');
      }
      if (req.method === 'GET' && !action) return json(res, 200, state(room));
      if (req.method === 'GET' && action === 'qr') {
        const join = `${requestOrigin(req)}/join/${code}`;
        const svg = await QRCode.toString(join, { type: 'svg', margin: 2, width: 320, color: { dark: '#0C1026', light: '#FFFFFF' } });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(svg);
      }
      if (req.method === 'GET' && action === 'events') {
        if (room.listeners.size >= MAX_CLIENTS) return fail(res, 429, 'Sala cheia.');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
        });
        res.write(': connected\n\n');
        sendEvent(res, state(room));
        room.listeners.add(res);
        const heartbeat = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 20000);
        req.on('close', () => { clearInterval(heartbeat); room.listeners.delete(res); });
        return;
      }
      if (req.method !== 'POST') return fail(res, 405, 'Método não permitido.');
      if (action === 'vote') {
        if (!room.question) return fail(res, 400, 'Ainda não há pergunta publicada.');
        const body = await readBody(req);
        const clientId = String(body.clientId || '');
        if (!/^[a-f0-9-]{20,80}$/.test(clientId)) return fail(res, 400, 'Identificador inválido.');
        const text = cleanInput(body.answer, MAX_ANSWER_LENGTH);
        if (text.length < 1) return fail(res, 400, 'Escreve a tua resposta.');
        const key = normalize(text);
        if (room.blocked.has(key)) return fail(res, 400, 'Esta resposta foi removida pelo moderador.');
        const now = Date.now();
        const last = room.rate.get(clientId) || 0;
        if (now - last < 1000) return fail(res, 429, 'Aguarda um instante antes de responder novamente.');
        if (room.answers.size >= MAX_RESPONSES && !room.answers.has(clientId)) return fail(res, 429, 'Limite de respostas atingido.');
        room.rate.set(clientId, now);
        room.answers.set(clientId, { text, key });
        touch(room); broadcast(room);
        return json(res, 200, { ok: true });
      }
      if (!isAdmin(req, room)) return fail(res, 403, 'Acesso exclusivo do administrador.');
      if (action === 'question') {
        const body = await readBody(req);
        const question = cleanInput(body.question, 150);
        if (!question) return fail(res, 400, 'Escreve uma pergunta.');
        room.question = question;
        room.version++;
        room.answers.clear(); room.blocked.clear(); room.rate.clear();
        touch(room); broadcast(room);
        return json(res, 200, { ok: true });
      }
      if (action === 'remove') {
        const body = await readBody(req);
        const key = normalize(cleanInput(body.answer, MAX_ANSWER_LENGTH));
        if (!key) return fail(res, 400, 'Resposta inválida.');
        room.blocked.add(key);
        for (const [id, answer] of room.answers) if (answer.key === key) room.answers.delete(id);
        touch(room); broadcast(room);
        return json(res, 200, { ok: true });
      }
      if (action === 'clear') {
        room.answers.clear(); room.blocked.clear(); room.rate.clear();
        touch(room); broadcast(room);
        return json(res, 200, { ok: true });
      }
      if (action === 'reset') {
        closeRoom(room);
        return json(res, 200, { ok: true });
      }
      return fail(res, 404, 'Acção desconhecida.');
    }
    if (req.method !== 'GET') return fail(res, 404, 'Não encontrado.');
    if (route === '/style.css') return serveFile(res, 'style.css');
    if (route === '/app.js') return serveFile(res, 'app.js');
    if (route === '/' || /^\/(admin\/[A-HJ-NP-Z2-9]{6}\/[a-f0-9]{64}|join\/[A-HJ-NP-Z2-9]{6}|screen\/[A-HJ-NP-Z2-9]{6})$/.test(route)) {
      return serveFile(res, 'index.html');
    }
    fail(res, 404, 'Página não encontrada.');
  } catch (error) {
    console.error('Request error:', error.message);
    if (!res.headersSent) fail(res, 400, error.message || 'Erro inesperado.');
    else { try { res.end(); } catch {} }
  }
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (Date.now() - room.updatedAt > ROOM_TTL_MS) closeRoom(room);
    else if (room.rate.size > 1000) room.rate.clear();
  }
}, 60_000).unref();
server.listen(PORT, '0.0.0.0', () => console.log(`Uma Geração Marcada LIVE on :${PORT}`));
