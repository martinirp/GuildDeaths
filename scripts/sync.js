const fs = require('fs/promises');
const path = require('path');

const GUILD_NAME = 'Insanity';
const TIBIADATA_BASE = 'https://api.tibiadata.com/v4';
const DATA_DIR = path.join(process.cwd(), 'data');
const DEATHS_FILE = path.join(DATA_DIR, 'deaths.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const HALL_FILE = path.join(DATA_DIR, 'hall-of-fame.json');

const CONCURRENCY = 8;
const REQUEST_DELAY_MS = 60;

function isDeathPvP(d) {
  if (d.type === 'pvp') return true;
  if (d.type === 'pve') return false;
  return Array.isArray(d.killers) && d.killers.some((k) => /^[A-Z]/.test(k) && !k.startsWith('The '));
}

function getTop3(deaths, mode) {
  const list =
    mode === 'pvp'
      ? deaths.filter(isDeathPvP)
      : mode === 'pve'
        ? deaths.filter((d) => !isDeathPvP(d))
        : deaths;

  const byPlayer = new Map();
  for (const d of list) {
    const entry = byPlayer.get(d.character) || {
      name: d.character,
      vocation: d.vocation || 'Unknown',
      count: 0,
      lastLevel: d.level,
      lastDeath: d.time,
    };
    entry.count++;
    byPlayer.set(d.character, entry);
  }

  return Array.from(byPlayer.values())
    .sort((a, b) => b.count - a.count || new Date(b.lastDeath).getTime() - new Date(a.lastDeath).getTime())
    .slice(0, 3)
    .map(({ name, vocation, count, lastLevel }) => ({ name, vocation, count, lastLevel }));
}

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

  console.log(`[Sync:full] Verificando todos os ${members.length} personagens da guild...`);

  let newDeaths = 0;

  async function processTargets(list, concurrency) {
    let cursor = 0;
    const failed = [];

    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= list.length) break;
        const member = list[idx];
        try {
          const data = await fetchJsonWithRetry(
            `${TIBIADATA_BASE}/character/${encodeURIComponent(member.name)}`,
            4
          );
          const charDeaths = data?.character?.deaths;
          if (Array.isArray(charDeaths)) {
            for (const death of charDeaths) {
              if (!death || !death.time) continue;
              const id = makeDeathId(member.name, death.time);
              const isPvP =
                (Array.isArray(death.killers) && death.killers.some((k) => k.player || k.summon)) ||
                (Array.isArray(death.assists) && death.assists.some((a) => a.player || a.summon));
              const deathType = isPvP ? 'pvp' : 'pve';

              if (deathsMap.has(id)) {
                const existing = deathsMap.get(id);
                if (!existing.type) {
                  existing.type = deathType;
                }
                continue;
              }

              const killers = Array.isArray(death.killers)
                ? death.killers.map((k) => k.name).filter(Boolean)
                : [];

              deathsMap.set(id, {
                id,
                type: deathType,
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
        } catch {
          failed.push(member);
        }
        await sleep(REQUEST_DELAY_MS);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, Math.max(1, list.length)) }, () => worker())
    );

    return failed;
  }

  let failedMembers = await processTargets(members, CONCURRENCY);
  if (failedMembers.length > 0) {
    console.log(`[Sync] Tentando novamente ${failedMembers.length} personagens que falharam...`);
    await sleep(2000);
    failedMembers = await processTargets(failedMembers, Math.max(2, Math.floor(CONCURRENCY / 2)));
  }
  if (failedMembers.length > 0) {
    console.warn(`[Sync] ${failedMembers.length} personagens falharam após novas tentativas.`);
  }

  const sorted = Array.from(deathsMap.values()).sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
  );

  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);

  let hall = [];
  try {
    const rawHall = await fs.readFile(HALL_FILE, 'utf-8');
    const parsedHall = JSON.parse(rawHall);
    if (Array.isArray(parsedHall)) hall = parsedHall;
  } catch {}

  const archivedMonths = new Set(hall.map((h) => h.month));
  const byMonth = new Map();
  const currentMonthDeaths = [];

  for (const d of sorted) {
    const month = (d.time || '').slice(0, 7);
    if (!month) continue;
    if (month === currentMonth) {
      currentMonthDeaths.push(d);
    } else if (month < currentMonth) {
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push(d);
    }
  }

  for (const [month, monthDeaths] of byMonth.entries()) {
    if (!archivedMonths.has(month)) {
      hall.push({
        month,
        totalDeaths: monthDeaths.length,
        total: getTop3(monthDeaths, 'total'),
        pvp: getTop3(monthDeaths, 'pvp'),
        pve: getTop3(monthDeaths, 'pve'),
      });
      archivedMonths.add(month);
    }
  }

  hall.sort((a, b) => b.month.localeCompare(a.month));

  const nowIso = now.toISOString();
  meta.lastFullSync = nowIso;
  meta.lastOnlineSync = nowIso;

  await fs.writeFile(DEATHS_FILE, JSON.stringify(currentMonthDeaths, null, 2), 'utf-8');
  await fs.writeFile(HALL_FILE, JSON.stringify(hall, null, 2), 'utf-8');
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');

  console.log(
    `[Sync] Concluído: ${newDeaths} novas mortes (mês ${currentMonth}: ${currentMonthDeaths.length}, meses no Hall da Fama: ${hall.length}).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

