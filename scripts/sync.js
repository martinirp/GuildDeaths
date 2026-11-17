const fs = require('fs/promises');
const path = require('path');

const GUILD_NAME = 'Insanity';
const TIBIADATA_BASE = 'https://api.tibiadata.com/v4';
const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const DEATHS_FILE = path.join(DATA_DIR, 'deaths.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');

const CONCURRENCY = 8;
const REQUEST_DELAY_MS = 60;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeDeathId(characterName, time) {
  return `${characterName.toLowerCase()}|${time}`;
}

async function fetchJsonWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Insanity-Death-Tracker/1.0',
        },
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(attempt * 1200);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(attempt * 800);
    }
  }
}

async function main() {
  const isFull = process.argv.includes('--full');
  await fs.mkdir(DATA_DIR, { recursive: true });

  const deathsMap = new Map();
  try {
    const raw = await fs.readFile(DEATHS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && item.id) deathsMap.set(item.id, item);
      }
    }
  } catch {}

  let meta = {
    guild: GUILD_NAME,
    world: null,
    membersCount: 0,
    lastOnlineSync: null,
    lastFullSync: null,
  };
  try {
    meta = { ...meta, ...JSON.parse(await fs.readFile(META_FILE, 'utf-8')) };
  } catch {}

  const guildData = await fetchJsonWithRetry(
    `${TIBIADATA_BASE}/guild/${encodeURIComponent(GUILD_NAME)}`
  );
  const members = guildData?.guild?.members || [];
  meta.world = guildData?.guild?.world || meta.world;
  meta.membersCount = members.length;

  const targets = isFull
    ? members
    : members.filter((m) => String(m.status).toLowerCase() === 'online');

  console.log(`[Sync:${isFull ? 'full' : 'online'}] Verificando ${targets.length} personagens...`);

  let cursor = 0;
  let newDeaths = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= targets.length) break;
      const member = targets[idx];
      try {
        const data = await fetchJsonWithRetry(
          `${TIBIADATA_BASE}/character/${encodeURIComponent(member.name)}`
        );
        const charDeaths = data?.character?.deaths;
        if (Array.isArray(charDeaths)) {
          for (const death of charDeaths) {
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
            newDeaths++;
          }
        }
      } catch {}
      await sleep(REQUEST_DELAY_MS);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, Math.max(1, targets.length)) }, () => worker())
  );

  const sorted = Array.from(deathsMap.values()).sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
  );

  const now = new Date().toISOString();
  if (isFull) meta.lastFullSync = now;
  else meta.lastOnlineSync = now;

  await fs.writeFile(DEATHS_FILE, JSON.stringify(sorted, null, 2), 'utf-8');
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');

  console.log(`[Sync] Concluído: ${newDeaths} novas mortes (total: ${sorted.length}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

