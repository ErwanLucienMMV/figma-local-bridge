import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import protocol from '../src/protocol.cjs';

export const PORT = 38475;
const MAX_BODY = 65536;
const TERMINAL = new Set(['succeeded', 'failed', 'rejected', 'expired', 'unknown', 'cancelled']);
const origins = new Set(['null', 'https://www.figma.com', 'https://figma.com']);
const secret = () => randomBytes(32).toString('hex');
function equal(a, b) {
  const aa = Buffer.from(a || ''), bb = Buffer.from(b || '');
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function error(status, message) { return Object.assign(new Error(message), { status }); }
async function body(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw error(415, 'application/json requis');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw error(413, 'Corps trop volumineux');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw error(400, 'JSON invalide'); }
}

export function createBridge({ agentToken = secret(), pluginToken = secret(), now = Date.now, jobTTL = 120000, sessionTTL = 30000 } = {}) {
  if (agentToken === pluginToken || !/^[a-f0-9]{64}$/.test(agentToken) || !/^[a-f0-9]{64}$/.test(pluginToken)) throw new Error('Deux secrets distincts de 256 bits sont requis');
  let session = null;
  const jobs = new Map();
  let windowStart = now(), count = 0;
  function finishSession() {
    if (!session) return;
    for (const job of jobs.values()) if (job.command.sessionId === session.sessionId && !TERMINAL.has(job.status)) {
      job.status = job.status === 'dispatched' ? 'unknown' : 'cancelled'; job.finishedAt = now();
    }
    session = null;
  }
  function sweep() {
    if (session && now() - session.lastSeen > sessionTTL) finishSession();
    for (const job of jobs.values()) if (now() > job.deadline && !TERMINAL.has(job.status)) {
      job.status = job.status === 'dispatched' ? 'unknown' : 'expired'; job.finishedAt = now();
    }
    // Keep duplicate IDs as tombstones for this process; reject new work at capacity.
  }
  function active(sid, touch = false) {
    if (!session || session.sessionId !== sid) throw error(409, 'Session absente ou périmée : reconnecter Figma');
    if (touch) session.lastSeen = now();
    return session;
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(data));
    };
    try {
      const address = server.address();
      if (req.socket.remoteAddress !== '127.0.0.1' || !['127.0.0.1:' + address.port, 'localhost:' + address.port].includes(req.headers.host)) throw error(403, 'Hôte de boucle locale requis');
      if (req.headers.origin !== undefined && !origins.has(req.headers.origin)) throw error(403, 'Origine interdite');
      // Figma sandbox fetch needs wildcard CORS. This never replaces bearer authentication.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (now() - windowStart > 10000) { windowStart = now(); count = 0; }
      if (++count > 200) throw error(429, 'Trop de requêtes, réessayer dans 10 secondes');
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.search || url.hash) throw error(400, 'Paramètres URL interdits');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const role = url.pathname.startsWith('/plugin/') ? 'plugin' : 'agent';
      const token = role === 'plugin' ? pluginToken : agentToken;
      if (!equal(req.headers.authorization, 'Bearer ' + token)) throw error(401, 'Authentification requise');
      // Ordinary browser pages cannot act as the agent even with an accidental CORS grant.
      if (role === 'agent' && req.headers.origin !== undefined) throw error(403, 'API agent réservée à un client local sans Origin');
      sweep();
      if (req.method === 'GET' && url.pathname === '/agent/session') {
        send(200, { session: session && { sessionId: session.sessionId, pageId: session.pageId, pageName: session.pageName, documentName: session.documentName, lastSeen: session.lastSeen, protocolRevision: session.protocolRevision || null, supportedOperations: session.protocolRevision === protocol.REVISION ? protocol.OPERATIONS : protocol.LEGACY_OPERATIONS } }); return;
      }
      if (req.method === 'GET' && url.pathname === '/agent/capabilities') {
        send(200, { protocolRevision: protocol.REVISION, operations: protocol.OPERATIONS, maxOperations: protocol.MAX_OPS, maxChildrenPerPage: 10, detailGroups: protocol.DETAIL_GROUPS, maxResultCharacters: 12000 }); return;
      }
      if (req.method === 'POST' && url.pathname === '/plugin/register') {
        const data = await body(req);
        protocol.keys(data, ['pageId', 'pageName', 'documentName'], ['protocolRevision'], 'enregistrement');
        if (data.protocolRevision !== undefined) protocol.string(data.protocolRevision, 20, 'protocolRevision', 1);
        protocol.id(data.pageId, 'pageId'); protocol.string(data.pageName, 200, 'pageName'); protocol.string(data.documentName, 200, 'documentName');
        if (session) throw error(409, 'Un plugin est déjà connecté. Le déconnecter ou attendre 30 secondes.');
        session = { ...data, sessionId: secret(), lastSeen: now() };
        send(201, { sessionId: session.sessionId, pageId: session.pageId }); return;
      }
      if (req.method === 'POST' && url.pathname === '/plugin/disconnect') {
        const data = await body(req); protocol.keys(data, ['sessionId'], [], 'déconnexion'); active(data.sessionId);
        finishSession(); send(200, { disconnected: true }); return;
      }
      if (req.method === 'POST' && url.pathname === '/plugin/next') {
        const data = await body(req); protocol.keys(data, ['sessionId', 'ready'], [], 'poll'); active(data.sessionId, true);
        if (typeof data.ready !== 'boolean') throw error(400, 'ready doit être booléen');
        const outstanding = [...jobs.values()].some(j => j.command.sessionId === data.sessionId && j.status === 'dispatched');
        const job = outstanding || !data.ready ? undefined : [...jobs.values()].find(j => j.command.sessionId === data.sessionId && j.status === 'queued');
        if (job) { job.status = 'dispatched'; job.dispatchedAt = now(); }
        send(200, { job: job ? { command: job.command, deadline: job.deadline } : null }); return;
      }
      if (req.method === 'POST' && url.pathname === '/agent/commands') {
        const data = await body(req); protocol.command(data); const s = active(data.sessionId);
        if (s.pageId !== data.pageId) throw error(409, 'Page non autorisée');
        const supported = s.protocolRevision === protocol.REVISION ? protocol.OPERATIONS : protocol.LEGACY_OPERATIONS;
        if (data.operations.some(op => !supported.includes(op.type)) || (s.protocolRevision !== protocol.REVISION && data.operations.some(op => op.type === 'getNodes' && op.details))) throw error(409, 'Plugin ancien : recharger la version ' + protocol.REVISION + ' et reconnecter');
        if (jobs.has(data.commandId)) throw error(409, 'commandId déjà utilisé : consulter son statut, ne pas le rejouer');
        if (jobs.size >= 2048) throw error(503, 'Historique plein : redémarrer le pont après vérification des statuts');
        if ([...jobs.values()].filter(j => !TERMINAL.has(j.status)).length >= 32) throw error(429, 'File pleine');
        const job = { command: data, status: 'queued', createdAt: now(), deadline: now() + jobTTL };
        jobs.set(data.commandId, job); send(202, { commandId: data.commandId, status: job.status, deadline: job.deadline }); return;
      }
      if (req.method === 'POST' && url.pathname === '/plugin/result') {
        const data = await body(req); protocol.keys(data, ['sessionId', 'commandId', 'result'], [], 'résultat');
        active(data.sessionId, true); protocol.id(data.commandId, 'commandId');
        const job = jobs.get(data.commandId);
        if (!job || job.command.sessionId !== data.sessionId) throw error(404, 'Commande inconnue');
        protocol.keys(data.result, ['status'], ['results', 'error', 'appliedCount', 'failedIndex', 'partialPossible'], 'résultat');
        if (!['succeeded', 'failed', 'rejected'].includes(data.result.status)) throw error(400, 'Statut invalide');
        if (job.result) {
          if (JSON.stringify(job.result) !== JSON.stringify(data.result)) throw error(409, 'Résultat déjà fixé');
          send(200, { accepted: true }); return;
        }
        if (!['dispatched', 'unknown'].includes(job.status)) throw error(409, 'Commande non distribuée');
        job.result = data.result; job.status = data.result.status; job.finishedAt = now(); send(200, { accepted: true }); return;
      }
      const match = /^\/agent\/commands\/([A-Za-z0-9][A-Za-z0-9:_-]{0,127})$/.exec(url.pathname);
      if (req.method === 'GET' && match) {
        const job = jobs.get(match[1]);
        if (!job) throw error(404, 'Commande inconnue');
        const { command, ...status } = job;
        send(200, { commandId: command.commandId, ...status }); return;
      }
      throw error(404, 'Route inconnue');
    } catch (e) {
      if (!res.headersSent && !res.destroyed) send(e.status || 400, { error: String(e.message || e).slice(0, 500) });
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000;
  server.maxConnections = 32;
  return { server, agentToken, pluginToken };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bridge = createBridge();
  bridge.server.on('error', e => { console.error('Démarrage impossible : ' + e.message); process.exitCode = 1; });
  bridge.server.listen(PORT, '127.0.0.1', async () => {
    try {
      const dir = path.join(root, '.local');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // Only the agent secret is stored. The plugin secret is copied once into Figma.
      const target = path.join(dir, 'agent.json');
      await writeFile(target, JSON.stringify({ url: 'http://127.0.0.1:' + PORT, token: bridge.agentToken }, null, 2) + '\n', { mode: 0o600 });
      console.log('Pont actif : http://127.0.0.1:' + PORT);
      console.log('Clé PLUGIN à coller dans Figma (valable pour ce lancement) :\n' + bridge.pluginToken);
      console.log('Clé agent enregistrée dans .local/agent.json. Ne pas partager ce fichier.');
      console.log('Arrêt : Ctrl+C. Un redémarrage change les deux clés et vide la file.');
    } catch (e) { console.error('Écriture des identifiants impossible : ' + e.message); bridge.server.close(); process.exitCode = 1; }
  });
}
