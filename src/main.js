const engine = createEngine(figma, BridgeProtocol);
const BASE = 'http://localhost:38475';
let connection = null;
let generation = 0;
let connecting = false;
// User-requested default. This setting lives only in the running plugin, never
// in an agent command. Changing it affects newly received mutation batches.
let autoApply = true;
figma.showUI(__html__, { width: 440, height: 640, themeColors: true });
const emit = message => figma.ui.postMessage(message);
const messageOf = e => String(e.message || e).slice(0, 500);
function selection() {
  emit({ type: 'selection', pageId: figma.currentPage.id, pageName: figma.currentPage.name,
    nodes: figma.currentPage.selection.slice(0, 50).map(engine.describe), truncated: figma.currentPage.selection.length > 50 });
}
async function request(token, route, data) {
  const response = await fetch(BASE + route, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Erreur HTTP ' + response.status);
  return json;
}
function enqueueResult(c, commandId, result) {
  // Bound response size, notably selections with large texts/instance properties.
  if (JSON.stringify(result).length > 12000) result = { status: 'failed', error: 'Résultat trop volumineux. Inspecter moins de calques.', partialPossible: result.appliedCount > 0 };
  c.outbox = { sessionId: c.sessionId, commandId, result };
  emit({ type: 'result', commandId, result });
}
async function disconnect(reason) {
  generation++;
  const c = connection; connection = null;
  if (c) {
    clearTimeout(c.timer);
    try { await request(c.token, '/plugin/disconnect', { sessionId: c.sessionId }); } catch (_) { /* expires server-side */ }
    c.token = '';
  }
  emit({ type: 'disconnected', message: reason || 'Déconnecté' });
}
async function applyJob(c, job, automatic) {
  if (c.applying) throw new Error('Une commande est déjà en cours');
  c.applying = true;
  emit({ type: 'executing', command: job.command, automatic });
  try {
    if (Date.now() > job.deadline) throw new Error('Commande expirée');
    const apply = await engine.prepare(job.command, () => connection === c && Date.now() <= job.deadline);
    if (connection !== c || Date.now() > job.deadline) throw new Error('Session fermée ou commande expirée pendant la préparation');
    enqueueResult(c, job.command.commandId, await apply());
    selection();
  } catch (e) { enqueueResult(c, job.command.commandId, { status: 'failed', error: messageOf(e) }); }
  finally { c.applying = false; }
}
async function tick(c) {
  if (connection !== c) return;
  try {
    if (figma.currentPage.id !== c.pageId) { await disconnect('Page changée : reconnecter pour autoriser cette page.'); return; }
    if (c.outbox) {
      await request(c.token, '/plugin/result', c.outbox);
      c.outbox = null;
    }
    const { job } = await request(c.token, '/plugin/next', { sessionId: c.sessionId, ready: !c.pending && !c.applying && !c.outbox });
    if (connection !== c) return;
    c.errors = 0;
    if (job) {
      if (c.pending || c.applying) throw new Error('Commande concurrente refusée');
      try {
        BridgeProtocol.command(job.command);
        if (job.command.sessionId !== c.sessionId || job.command.pageId !== c.pageId || !Number.isFinite(job.deadline) || Date.now() > job.deadline) throw new Error('Commande hors session, hors page ou expirée');
        if (c.seen.has(job.command.commandId)) throw new Error('Commande déjà reçue, exécution refusée');
        c.seen.add(job.command.commandId);
        if (BridgeProtocol.readOnly(job.command)) {
          const apply = await engine.prepare(job.command, () => connection === c && Date.now() <= job.deadline);
          if (connection === c) enqueueResult(c, job.command.commandId, await apply());
        } else if (autoApply) {
          await applyJob(c, job, true);
        } else {
          c.pending = job;
          emit({ type: 'pending', command: job.command, deadline: job.deadline });
        }
      } catch (e) { enqueueResult(c, job.command.commandId, { status: 'failed', error: messageOf(e) }); }
    }
    if (c.pending && Date.now() > c.pending.deadline) {
      enqueueResult(c, c.pending.command.commandId, { status: 'rejected', error: 'Délai de validation dépassé' });
      c.pending = null;
    }
  } catch (e) {
    if (connection !== c) return;
    emit({ type: 'warning', message: 'Pont : ' + messageOf(e) });
    if (++c.errors >= 5) { await disconnect('Connexion perdue. Vérifier les statuts avant toute nouvelle commande.'); return; }
  }
  if (connection === c) c.timer = setTimeout(() => tick(c), 1000);
}
async function connect(token) {
  if (connecting || connection) throw new Error('Déconnecter la session actuelle avant de reconnecter');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Clé plugin invalide : 64 caractères hexadécimaux attendus');
  connecting = true;
  const gen = ++generation;
  const pageId = figma.currentPage.id;
  try {
    const registration = await request(token, '/plugin/register', { pageId, pageName: figma.currentPage.name.slice(0, 200), documentName: figma.root.name.slice(0, 200), protocolRevision: BridgeProtocol.REVISION });
    if (gen !== generation || figma.currentPage.id !== pageId) {
      await request(token, '/plugin/disconnect', { sessionId: registration.sessionId });
      throw new Error('Connexion annulée ou page changée');
    }
    connection = { token, pageId, sessionId: registration.sessionId, pending: null, outbox: null, applying: false, seen: new Set(), errors: 0 };
    emit({ type: 'connected', sessionId: connection.sessionId, pageId });
    tick(connection);
  } finally { connecting = false; }
}
figma.ui.onmessage = async message => {
  try {
    if (!message || typeof message !== 'object') throw new Error('Message UI invalide');
    switch (message.type) {
      case 'ready':
        emit({ type: 'mode', autoApply });
        selection();
        if (connection) {
          emit({ type: 'connected', sessionId: connection.sessionId, pageId: connection.pageId });
          if (connection.pending) emit({ type: 'pending', command: connection.pending.command, deadline: connection.pending.deadline });
        } else emit({ type: 'disconnected', message: 'Déconnecté · interface prête' });
        break;
      case 'selection': selection(); break;
      case 'setAutoApply':
        BridgeProtocol.keys(message, ['type', 'enabled'], [], 'mode UI');
        if (typeof message.enabled !== 'boolean') throw new Error('Mode automatique : booléen attendu');
        autoApply = message.enabled;
        emit({ type: 'mode', autoApply });
        break;
      case 'connect': await connect(message.token); break;
      case 'disconnect': await disconnect(); break;
      case 'apply': case 'reject': {
        const c = connection;
        if (!c || !c.pending || c.pending.command.commandId !== message.commandId || c.applying) throw new Error('Aucune commande correspondante en attente');
        const job = c.pending; c.pending = null;
        if (message.type === 'reject') { enqueueResult(c, job.command.commandId, { status: 'rejected', error: 'Refusé dans Figma' }); break; }
        await applyJob(c, job, false);
        break;
      }
      default: throw new Error('Action UI inconnue');
    }
  } catch (e) { emit({ type: 'warning', message: messageOf(e) }); }
};
figma.on('selectionchange', selection);
figma.on('currentpagechange', () => { selection(); if (connection) disconnect('Page changée : reconnecter le plugin.'); });
// Closing Figma/the plugin stops polling; the bridge expires its session after 30 s.
