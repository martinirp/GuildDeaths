const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = process.env.PORT || 3456;
const GUILD_NAME = 'Insanity';
const TIBIADATA_BASE = 'https://api.tibiadata.com/v4';

const DATA_DIR = path.join(__dirname, 'public', 'data');
const DEATHS_FILE = path.join(DATA_DIR, 'deaths.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const CONCURRENCY = 6;
const REQUEST_DELAY_MS = 80;
const ONLINE_SYNC_INTERVAL_MS = 1 * 60 * 1000; // 1 minuto
const FULL_SYNC_INTERVAL_MS = 60 * 60 * 1000;  // 60 minutos

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

let deathsMap = new Map();
let meta = {
  guild: GUILD_NAME,
  world: null,
  membersCount: 0,
  lastOnlineSync: null,
  lastFullSync: null,
};

const syncState = {
  running: false,
  mode: null,
  processed: 0,
  total: 0,
  newDeathsFound: 0,
  errors: 0,
  startedAt: null,
};

let writeQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeDeathId(characterName, time) {
  return `${characterName.toLowerCase()}|${time}`;
}

function isPvEDeath(death) {
  if (!death || !Array.isArray(death.killers) || death.killers.length === 0) {
    return false;
  }
  const allKillersPvE = death.killers.every((k) => !k.player && !k.summon);
  const allAssistsPvE = !Array.isArray(death.assists) || death.assists.every((a) => !a.player && !a.summon);
  return allKillersPvE && allAssistsPvE;
}

async function atomicWriteJson(filePath, data) {
  writeQueue = writeQueue.then(async () => {
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
  });
  return writeQueue;
}

async function initStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const rawDeaths = await fs.readFile(DEATHS_FILE, 'utf-8');
    const parsed = JSON.parse(rawDeaths);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && item.id) {
          deathsMap.set(item.id, item);
        }
      }
    }
    console.log(`[Storage] ${deathsMap.size} mortes PvE carregadas de data/deaths.json`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[Storage] Erro ao ler deaths.json:', err.message);
    }
    await atomicWriteJson(DEATHS_FILE, []);
  }

  try {
    const rawMeta = await fs.readFile(META_FILE, 'utf-8');
    const parsedMeta = JSON.parse(rawMeta);
    meta = { ...meta, ...parsedMeta };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[Storage] Erro ao ler meta.json:', err.message);
    }
    await atomicWriteJson(META_FILE, meta);
  }
}

function getSortedDeaths() {
  return Array.from(deathsMap.values()).sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
  );
}

async function saveDeaths() {
  await atomicWriteJson(DEATHS_FILE, getSortedDeaths());
}

async function saveMeta() {
  await atomicWriteJson(META_FILE, meta);
}

async function fetchJsonWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Insanity-PvE-Tracker/1.0',
        },
      });

      if (res.status === 429 || res.status >= 500) {
        const waitMs = attempt * 1200;
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(attempt * 800);
    }
  }
}

async function fetchGuildMembers() {
  const url = `${TIBIADATA_BASE}/guild/${encodeURIComponent(GUILD_NAME)}`;
  const data = await fetchJsonWithRetry(url);
  if (!data || !data.guild || !Array.isArray(data.guild.members)) {
    throw new Error('Resposta inválida da API para a guild.');
  }
  meta.world = data.guild.world || meta.world;
  meta.membersCount = data.guild.members.length;
  return data.guild.members;
}

function recordCharacterDeaths(member, deaths) {
  if (!Array.isArray(deaths)) return 0;
  let added = 0;

  for (const death of deaths) {
    if (!death || !death.time) continue;

    const id = makeDeathId(member.name, death.time);
    if (deathsMap.has(id)) continue;

    const killers = Array.isArray(death.killers)
      ? death.killers.map((k) => k.name).filter(Boolean)
      : [];
    deathsMap.set(id, {
      id,
      character: member.name,
      vocation: member.vocation || 'Unknown',
      rank: member.rank || '',
      level: death.level,
      time: death.time,
      killers,
      reason: death.reason || `Died at Level ${death.level} by ${killers.join(', ')}.`,
      recordedAt: new Date().toISOString(),
    });
    added++;
  }

  return added;
}

async function runSync(mode = 'online') {
  if (syncState.running) {
    return { started: false, message: 'Sincronização já está em andamento.' };
  }

  syncState.running = true;
  syncState.mode = mode;
  syncState.processed = 0;
  syncState.total = 0;
  syncState.newDeathsFound = 0;
  syncState.errors = 0;
  syncState.startedAt = new Date().toISOString();

  (async () => {
    try {
      const members = await fetchGuildMembers();
      const targets =
        mode === 'full'
          ? members
          : members.filter((m) => String(m.status).toLowerCase() === 'online');

      syncState.total = targets.length;
      console.log(`[Sync:${mode}] Verificando ${targets.length} personagens...`);

      let cursor = 0;
      let dirtyCount = 0;

      async function worker() {
        while (true) {
          const index = cursor++;
          if (index >= targets.length) break;

          const member = targets[index];
          try {
            const url = `${TIBIADATA_BASE}/character/${encodeURIComponent(member.name)}`;
            const data = await fetchJsonWithRetry(url);
            const charDeaths = data?.character?.deaths;
            const added = recordCharacterDeaths(member, charDeaths);
            if (added > 0) {
              syncState.newDeathsFound += added;
              dirtyCount += added;
              if (dirtyCount >= 5) {
                dirtyCount = 0;
                await saveDeaths();
              }
            }
          } catch (err) {
            syncState.errors++;
          } finally {
            syncState.processed++;
          }

          await sleep(REQUEST_DELAY_MS);
        }
      }

      const workers = Array.from({ length: Math.min(CONCURRENCY, Math.max(1, targets.length)) }, () =>
        worker()
      );
      await Promise.all(workers);

      if (dirtyCount > 0 || syncState.newDeathsFound > 0) {
        await saveDeaths();
      }

      const now = new Date().toISOString();
      if (mode === 'full') {
        meta.lastFullSync = now;
      } else {
        meta.lastOnlineSync = now;
      }
      await saveMeta();

      console.log(
        `[Sync:${mode}] Concluído! ${syncState.newDeathsFound} novas mortes PvE registradas (${syncState.errors} erros).`
      );
    } catch (err) {
      console.error(`[Sync:${mode}] Falha geral:`, err.message);
    } finally {
      syncState.running = false;
    }
  })();

  return { started: true, mode };
}

function buildStats() {
  const all = getSortedDeaths();
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  let deaths24h = 0;
  let deaths7d = 0;
  const byPlayer = new Map();
  const byCreature = new Map();
  const byVocation = new Map();

  for (const d of all) {
    const ts = new Date(d.time).getTime();
    if (ts >= oneDayAgo) deaths24h++;
    if (ts >= sevenDaysAgo) deaths7d++;

    const playerEntry = byPlayer.get(d.character) || {
      name: d.character,
      vocation: d.vocation,
      count: 0,
      lastLevel: d.level,
      lastDeath: d.time,
      lastKillers: d.killers || [],
    };
    playerEntry.count++;
    byPlayer.set(d.character, playerEntry);

    for (const k of d.killers || []) {
      byCreature.set(k, (byCreature.get(k) || 0) + 1);
    }

    const voc = d.vocation || 'Unknown';
    byVocation.set(voc, (byVocation.get(voc) || 0) + 1);
  }

  const topVictims = Array.from(byPlayer.values())
    .sort((a, b) => b.count - a.count || new Date(b.lastDeath).getTime() - new Date(a.lastDeath).getTime())
    .slice(0, 100);

  const topCreatures = Array.from(byCreature.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const vocationBreakdown = Array.from(byVocation.entries())
    .map(([vocation, count]) => ({ vocation, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalDeaths: all.length,
    deaths24h,
    deaths7d,
    topVictims,
    topCreatures,
    vocationBreakdown,
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function serveStatic(reqPath, res) {
  const safePath = reqPath === '/' ? '/index.html' : reqPath;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    });
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      meta,
      sync: syncState,
      totalDeathsStored: deathsMap.size,
    });
  }

  if (pathname === '/api/deaths' && req.method === 'GET') {
    const search = (urlObj.searchParams.get('search') || '').trim().toLowerCase();
    const vocation = (urlObj.searchParams.get('vocation') || '').trim().toLowerCase();
    const sort = urlObj.searchParams.get('sort') || 'recent';

    let list = getSortedDeaths();

    if (search) {
      list = list.filter(
        (d) =>
          d.character.toLowerCase().includes(search) ||
          d.reason.toLowerCase().includes(search) ||
          (d.killers || []).some((k) => k.toLowerCase().includes(search))
      );
    }

    if (vocation && vocation !== 'all') {
      list = list.filter((d) => d.vocation.toLowerCase().includes(vocation));
    }

    if (sort === 'level_desc') {
      list.sort((a, b) => b.level - a.level);
    } else if (sort === 'level_asc') {
      list.sort((a, b) => a.level - b.level);
    }

    return sendJson(res, 200, {
      total: list.length,
      deaths: list,
    });
  }

  if (pathname === '/api/stats' && req.method === 'GET') {
    return sendJson(res, 200, buildStats());
  }

  if (pathname === '/api/sync' && req.method === 'POST') {
    const mode = urlObj.searchParams.get('mode') === 'full' ? 'full' : 'online';
    const result = await runSync(mode);
    return sendJson(res, result.started ? 202 : 409, result);
  }

  return serveStatic(pathname, res);
});

async function start() {
  await initStorage();

  server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  Insanity PvE Death Tracker`);
    console.log(`  Acesse: http://localhost:${PORT}`);
    console.log(`  Armazenamento: ${DEATHS_FILE}`);
    console.log(`========================================\n`);

    // Sincroniza jogadores online logo ao iniciar
    runSync('online');

    // Sincronização automática periódica
    setInterval(() => runSync('online'), ONLINE_SYNC_INTERVAL_MS);
    setInterval(() => runSync('full'), FULL_SYNC_INTERVAL_MS);
  });
}

start();
