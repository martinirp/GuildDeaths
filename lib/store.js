const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const DEATHS_FILE = path.join(DATA_DIR, 'deaths.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');

function readDeaths() {
  try {
    const raw = fs.readFileSync(DEATHS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readMeta() {
  try {
    const raw = fs.readFileSync(META_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {
      guild: 'Insanity',
      world: null,
      membersCount: 0,
      lastOnlineSync: null,
      lastFullSync: null,
    };
  }
}

function filterDeaths(deaths, { search = '', vocation = '', sort = 'recent' } = {}) {
  let list = [...deaths];
  const s = search.trim().toLowerCase();
  const voc = vocation.trim().toLowerCase();

  if (s) {
    list = list.filter(
      (d) =>
        (d.character || '').toLowerCase().includes(s) ||
        (d.reason || '').toLowerCase().includes(s) ||
        (d.killers || []).some((k) => k.toLowerCase().includes(s))
    );
  }

  if (voc && voc !== 'all') {
    list = list.filter((d) => (d.vocation || '').toLowerCase().includes(voc));
  }

  if (sort === 'level_desc') {
    list.sort((a, b) => b.level - a.level);
  } else if (sort === 'level_asc') {
    list.sort((a, b) => a.level - b.level);
  } else {
    list.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }

  return list;
}

function buildStats(deaths) {
  const sorted = [...deaths].sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
  );

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  let deaths24h = 0;
  let deaths7d = 0;
  const byPlayer = new Map();
  const byCreature = new Map();

  for (const d of sorted) {
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
  }

  const topVictims = Array.from(byPlayer.values())
    .sort((a, b) => b.count - a.count || new Date(b.lastDeath).getTime() - new Date(a.lastDeath).getTime())
    .slice(0, 100);

  const topCreatures = Array.from(byCreature.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    totalDeaths: sorted.length,
    deaths24h,
    deaths7d,
    topVictims,
    topCreatures,
  };
}

module.exports = {
  readDeaths,
  readMeta,
  filterDeaths,
  buildStats,
};

