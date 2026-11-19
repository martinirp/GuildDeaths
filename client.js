const PAGE_SIZE = 50;
const TOP_PAGE_SIZE = 10;
const GITHUB_DATA_BASE = 'https://raw.githubusercontent.com/martinirp/GuildDeaths/main/data';

async function fetchDataJson(filename) {
  const bust = Date.now();
  try {
    const res = await fetch(`${GITHUB_DATA_BASE}/${filename}?t=${bust}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  try {
    const res = await fetch(`/data/${filename}?t=${bust}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

let rawDeaths = [];
let allDeaths = [];
let top100List = [];
let allCreaturesByMode = { total: [], pvp: [], pve: [] };
let allHallList = [];
let currentPage = 1;
let topCurrentPage = 1;
let topMode = 'total';
let creaturesMode = 'total';
let statsMode = 'total';
let pollTimer = null;

const el = {
  guildMeta: document.getElementById('guild-meta'),
  top100Title: document.getElementById('top100-title'),
  statTotal: document.getElementById('stat-total'),
  stat24h: document.getElementById('stat-24h'),
  stat7d: document.getElementById('stat-7d'),
  statVisitors: document.getElementById('stat-visitors'),
  statTopPvp: document.getElementById('stat-top-pvp'),
  statTopPvpCount: document.getElementById('stat-top-pvp-count'),
  statTopPve: document.getElementById('stat-top-pve'),
  statTopPveCount: document.getElementById('stat-top-pve-count'),
  statTopCreaturePvp: document.getElementById('stat-top-creature-pvp'),
  statTopCreaturePvpCount: document.getElementById('stat-top-creature-pvp-count'),
  statTopCreaturePve: document.getElementById('stat-top-creature-pve'),
  statTopCreaturePveCount: document.getElementById('stat-top-creature-pve-count'),
  top100Search: document.getElementById('top100-search'),
  filterSearch: document.getElementById('filter-search'),
  filterVocation: document.getElementById('filter-vocation'),
  filterSort: document.getElementById('filter-sort'),
  creaturesSearch: document.getElementById('creatures-search'),
  hallSearch: document.getElementById('hall-search'),
  deathsTbody: document.getElementById('deaths-tbody'),
  top100Tbody: document.getElementById('top100-tbody'),
  top100Prev: document.getElementById('top100-prev'),
  top100Next: document.getElementById('top100-next'),
  top100Range: document.getElementById('top100-range'),
  top100PaginationTop: document.getElementById('top100-pagination-top'),
  top100Pagination: document.getElementById('top100-pagination'),
  pagination: document.getElementById('pagination'),
  creaturesTitle: document.getElementById('creatures-title'),
  rankingCreatures: document.getElementById('ranking-creatures'),
  hallContainer: document.getElementById('hall-container'),
  statsTitle: document.getElementById('stats-title'),
  statsAvgDay: document.getElementById('stats-avg-day'),
  statsAvgSub: document.getElementById('stats-avg-sub'),
  statsPeakDay: document.getElementById('stats-peak-day'),
  statsPeakCount: document.getElementById('stats-peak-count'),
  statsProjection: document.getElementById('stats-projection'),
  statsProjectionSub: document.getElementById('stats-projection-sub'),
  statsSplit: document.getElementById('stats-split'),
  statsSplitSub: document.getElementById('stats-split-sub'),
  statsChartWrap: document.getElementById('stats-chart-wrap'),
  statsChartSvg: document.getElementById('stats-chart-svg'),
  statsTooltip: document.getElementById('stats-tooltip'),
  statsVocationBars: document.getElementById('stats-vocation-bars'),
};

function getCurrentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function formatMonthLabel(monthKey) {
  if (!monthKey || !monthKey.includes('-')) return monthKey || '—';
  const [year, month] = monthKey.split('-');
  const names = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  const idx = Number(month) - 1;
  return `${names[idx] || month}/${year}`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isDeathPvP(d) {
  if (d.type === 'pvp') return true;
  if (d.type === 'pve') return false;
  return Array.isArray(d.killers) && d.killers.some((k) => /^[A-Z]/.test(k) && !k.startsWith('The '));
}

function computeTopVictims(deaths, mode = 'total', limit = 100) {
  const filtered =
    mode === 'pvp'
      ? deaths.filter(isDeathPvP)
      : mode === 'pve'
        ? deaths.filter((d) => !isDeathPvP(d))
        : deaths;

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
  );

  const byPlayer = new Map();
  for (const d of sorted) {
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
  }

  const ranked = Array.from(byPlayer.values())
    .sort((a, b) => b.count - a.count || new Date(b.lastDeath).getTime() - new Date(a.lastDeath).getTime())
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

  return Number.isFinite(limit) ? ranked.slice(0, limit) : ranked;
}

function computeStats(deaths) {
  const sorted = [...deaths].sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
  );

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  let deaths24h = 0;
  let deaths7d = 0;
  const byCreature = new Map();
  const byCreaturePvp = new Map();
  const byCreaturePve = new Map();

  for (const d of sorted) {
    const ts = new Date(d.time).getTime();
    if (ts >= oneDayAgo) deaths24h++;
    if (ts >= sevenDaysAgo) deaths7d++;

    const pvp = isDeathPvP(d);
    for (const k of d.killers || []) {
      byCreature.set(k, (byCreature.get(k) || 0) + 1);
      if (pvp) {
        if (!/^[a-z]/.test(k)) {
          byCreaturePvp.set(k, (byCreaturePvp.get(k) || 0) + 1);
        }
      } else {
        byCreaturePve.set(k, (byCreaturePve.get(k) || 0) + 1);
      }
    }
  }

  const topVictims = computeTopVictims(sorted, 'total');
  const topVictimsPvp = computeTopVictims(sorted, 'pvp', 1);
  const topVictimsPve = computeTopVictims(sorted, 'pve', 1);

  const allCreatures = Array.from(byCreature.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

  const allCreaturesPvp = Array.from(byCreaturePvp.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

  const allCreaturesPve = Array.from(byCreaturePve.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

  const topCreatures = allCreatures.slice(0, 15);
  const topCreaturesPvp = allCreaturesPvp.slice(0, 1);
  const topCreaturesPve = allCreaturesPve.slice(0, 1);

  return {
    totalDeaths: sorted.length,
    deaths24h,
    deaths7d,
    topVictims,
    topVictimsPvp,
    topVictimsPve,
    topCreatures,
    topCreaturesPvp,
    topCreaturesPve,
    allCreatures,
    allCreaturesPvp,
    allCreaturesPve,
  };
}

function applyFilters() {
  const search = el.filterSearch.value.trim().toLowerCase();
  const vocation = el.filterVocation.value.trim().toLowerCase();
  const sort = el.filterSort.value;

  let list = [...rawDeaths];

  if (search) {
    list = list.filter(
      (d) =>
        (d.character || '').toLowerCase().includes(search) ||
        (d.reason || '').toLowerCase().includes(search) ||
        (d.killers || []).some((k) => k.toLowerCase().includes(search))
    );
  }

  if (vocation && vocation !== 'all') {
    list = list.filter((d) => (d.vocation || '').toLowerCase().includes(vocation));
  }

  if (sort === 'level_desc') {
    list.sort((a, b) => b.level - a.level);
  } else if (sort === 'level_asc') {
    list.sort((a, b) => a.level - b.level);
  } else {
    list.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }

  allDeaths = list;
  currentPage = 1;
  renderDeathsTable();
}

let guildInfo = { world: 'Quelibra', membersCount: 0 };

function updateMetaBanner(isoTime) {
  const worldText = guildInfo.world || '';
  const membersText = guildInfo.membersCount ? `${guildInfo.membersCount} membros` : '';
  const syncText = isoTime ? `Última atualização: ${formatDateTime(isoTime)}` : '';
  el.guildMeta.textContent = [worldText, membersText, syncText].filter(Boolean).join(' • ');
}

async function syncLiveOnlineDeaths() {
  try {
    const guildRes = await fetch('https://api.tibiadata.com/v4/guild/Insanity');
    if (!guildRes.ok) return;
    const guildData = await guildRes.json();
    const members = guildData?.guild?.members;
    if (!Array.isArray(members)) return;

    guildInfo.world = guildData.guild.world || guildInfo.world;
    guildInfo.membersCount = members.length;

    const onlineMembers = members.filter(
      (m) => String(m.status).toLowerCase() === 'online'
    );

    const currentMonth = getCurrentMonthKey();
    const deathsMap = new Map(
      rawDeaths.map((d) => [d.id || `${d.character.toLowerCase()}|${d.time}`, d])
    );

    const remoteDeaths = await fetchDataJson('deaths.json');
    if (Array.isArray(remoteDeaths)) {
      for (const d of remoteDeaths) {
        if (!d || !d.time || (d.time || '').slice(0, 7) !== currentMonth) continue;
        const id = d.id || `${d.character.toLowerCase()}|${d.time}`;
        if (!deathsMap.has(id)) deathsMap.set(id, d);
      }
    }

    let cursor = 0;
    const concurrency = 6;
    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= onlineMembers.length) break;
        const member = onlineMembers[idx];
        try {
          const res = await fetch(
            `https://api.tibiadata.com/v4/character/${encodeURIComponent(member.name)}`
          );
          if (!res.ok) continue;
          const data = await res.json();
          const charDeaths = data?.character?.deaths;
          if (!Array.isArray(charDeaths)) continue;

          for (const death of charDeaths) {
            if (!death || !death.time) continue;
            if ((death.time || '').slice(0, 7) !== currentMonth) continue;

            const id = `${member.name.toLowerCase()}|${death.time}`;
            if (deathsMap.has(id)) continue;

            const isPvP =
              (Array.isArray(death.killers) && death.killers.some((k) => k.player || k.summon)) ||
              (Array.isArray(death.assists) && death.assists.some((a) => a.player || a.summon));
            const killers = Array.isArray(death.killers)
              ? death.killers.map((k) => k.name).filter(Boolean)
              : [];

            deathsMap.set(id, {
              id,
              type: isPvP ? 'pvp' : 'pve',
              character: member.name,
              vocation: member.vocation || 'Unknown',
              rank: member.rank || '',
              level: death.level,
              time: death.time,
              killers,
              reason: death.reason || `Died at Level ${death.level} by ${killers.join(', ')}.`,
            });
          }
        } catch {}
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, Math.max(1, onlineMembers.length)) }, () => worker())
    );

    rawDeaths = Array.from(deathsMap.values()).sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
    );

    updateMetaBanner(new Date().toISOString());
    const stats = computeStats(rawDeaths);
    renderStats(stats);
    applyFilters();
  } catch (err) {
    console.error('Erro na atualização ao vivo:', err);
  }
}

async function scheduleLiveSync() {
  await syncLiveOnlineDeaths();
  clearTimeout(pollTimer);
  pollTimer = setTimeout(scheduleLiveSync, 60000);
}

async function loadData() {
  try {
    const [parsedDeaths, meta, parsedHall] = await Promise.all([
      fetchDataJson('deaths.json'),
      fetchDataJson('meta.json'),
      fetchDataJson('hall-of-fame.json'),
    ]);

    const currentMonth = getCurrentMonthKey();

    if (Array.isArray(parsedDeaths)) {
      rawDeaths = parsedDeaths.filter((d) => (d.time || '').slice(0, 7) === currentMonth);
    }

    allHallList = Array.isArray(parsedHall) ? parsedHall : [];

    if (meta && typeof meta === 'object') {
      guildInfo.world = meta.world || guildInfo.world;
      guildInfo.membersCount = meta.membersCount || guildInfo.membersCount;
      const lastSync =
        meta.lastFullSync && meta.lastOnlineSync
          ? new Date(meta.lastFullSync) > new Date(meta.lastOnlineSync)
            ? meta.lastFullSync
            : meta.lastOnlineSync
          : meta.lastFullSync || meta.lastOnlineSync;
      updateMetaBanner(lastSync);
    }

    const stats = computeStats(rawDeaths);
    renderStats(stats);
    applyFilters();
    renderHallOfFame(allHallList);

    await scheduleLiveSync();
  } catch (err) {
    console.error('Erro ao carregar dados:', err);
    clearTimeout(pollTimer);
    pollTimer = setTimeout(scheduleLiveSync, 60000);
  }
}

function setHighlightItem(nameEl, countEl, list, singular, plural) {
  if (!nameEl || !countEl) return;
  if (list && list.length > 0) {
    const top = list[0];
    nameEl.textContent = top.name;
    countEl.textContent = `${top.count} ${top.count === 1 ? singular : plural}`;
  } else {
    nameEl.textContent = '—';
    countEl.textContent = '—';
  }
}

function renderStats(stats) {
  el.statTotal.textContent = stats.totalDeaths;
  el.stat24h.textContent = stats.deaths24h;
  el.stat7d.textContent = stats.deaths7d;

  setHighlightItem(el.statTopPvp, el.statTopPvpCount, stats.topVictimsPvp, 'morte', 'mortes');
  setHighlightItem(el.statTopPve, el.statTopPveCount, stats.topVictimsPve, 'morte', 'mortes');

  setHighlightItem(el.statTopCreaturePvp, el.statTopCreaturePvpCount, stats.topCreaturesPvp, 'abate', 'abates');
  setHighlightItem(el.statTopCreaturePve, el.statTopCreaturePveCount, stats.topCreaturesPve, 'abate', 'abates');

  renderRankings(stats);
}

function renderDeathsTable() {
  if (allDeaths.length === 0) {
    el.deathsTbody.innerHTML =
      '<tr><td colspan="5" class="empty-cell">Nenhuma morte encontrada.</td></tr>';
    el.pagination.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(allDeaths.length / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = allDeaths.slice(start, start + PAGE_SIZE);

  el.deathsTbody.innerHTML = pageItems
    .map((d) => {
      const charUrl = `https://www.tibia.com/community/?name=${encodeURIComponent(d.character)}`;
      const killersText = (d.killers && d.killers.length > 0) ? d.killers.join(', ') : d.reason;
      return `
        <tr>
          <td>${escapeHtml(formatDateTime(d.time))}</td>
          <td>
            <a class="char-link" href="${charUrl}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(d.character)}
            </a>
          </td>
          <td><span class="level-badge">${escapeHtml(d.level)}</span></td>
          <td>${escapeHtml(d.vocation)}</td>
          <td title="${escapeHtml(d.reason)}">${escapeHtml(killersText)}</td>
        </tr>
      `;
    })
    .join('');

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  if (totalPages <= 1) {
    el.pagination.innerHTML = '';
    return;
  }

  const buttons = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2) {
      buttons.push(
        `<button class="page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`
      );
    } else if (buttons[buttons.length - 1] !== '<span class="muted">...</span>') {
      buttons.push('<span class="muted">...</span>');
    }
  }
  el.pagination.innerHTML = buttons.join('');

  el.pagination.querySelectorAll('.page-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentPage = Number(btn.dataset.page);
      renderDeathsTable();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function renderTop100Table() {
  if (top100List.length === 0) {
    el.top100Tbody.innerHTML =
      '<tr><td colspan="6" class="empty-cell">Nenhuma morte registrada ainda.</td></tr>';
    el.top100Range.textContent = '0–0';
    el.top100Prev.disabled = true;
    el.top100Next.disabled = true;
    el.top100PaginationTop.innerHTML = '';
    el.top100Pagination.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(top100List.length / TOP_PAGE_SIZE);
  if (topCurrentPage > totalPages) topCurrentPage = totalPages;

  const start = (topCurrentPage - 1) * TOP_PAGE_SIZE;
  const end = Math.min(start + TOP_PAGE_SIZE, top100List.length);
  const pageItems = top100List.slice(start, end);

  el.top100Range.textContent = `${start + 1}–${end}`;
  el.top100Prev.disabled = topCurrentPage <= 1;
  el.top100Next.disabled = topCurrentPage >= totalPages;

  el.top100Tbody.innerHTML = pageItems
    .map((v, idx) => {
      const pos = v.rank || (start + idx + 1);
      const rankClass = pos <= 3 ? `rank-${pos}` : '';
      const charUrl = `https://www.tibia.com/community/?name=${encodeURIComponent(v.name)}`;
      const lastKillers = (v.lastKillers && v.lastKillers.length > 0) ? v.lastKillers.join(', ') : '—';
      return `
        <tr>
          <td><span class="rank-badge ${rankClass}">#${pos}</span></td>
          <td>
            <a class="char-link" href="${charUrl}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(v.name)}
            </a>
          </td>
          <td>${escapeHtml(v.vocation)}</td>
          <td><span class="level-badge">${escapeHtml(v.lastLevel)}</span></td>
          <td>${escapeHtml(formatDateTime(v.lastDeath))} <small style="color:var(--tibia-brown-muted)">(${escapeHtml(lastKillers)})</small></td>
          <td style="text-align: center;"><span class="death-count-pill">${v.count}</span></td>
        </tr>
      `;
    })
    .join('');

  renderTop100Pagination(totalPages);
}

function renderTop100Pagination(totalPages) {
  if (totalPages <= 1) {
    el.top100PaginationTop.innerHTML = '';
    el.top100Pagination.innerHTML = '';
    return;
  }

  const buttonsHtml = Array.from({ length: totalPages }, (_, i) => {
    const p = i + 1;
    const from = i * TOP_PAGE_SIZE + 1;
    const to = Math.min((i + 1) * TOP_PAGE_SIZE, top100List.length);
    return `<button class="page-btn ${p === topCurrentPage ? 'active' : ''}" data-top-page="${p}">${from}–${to}</button>`;
  }).join('');

  el.top100PaginationTop.innerHTML = buttonsHtml;
  el.top100Pagination.innerHTML = buttonsHtml;

  [el.top100PaginationTop, el.top100Pagination].forEach((container) => {
    container.querySelectorAll('[data-top-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        topCurrentPage = Number(btn.dataset.topPage);
        renderTop100Table();
      });
    });
  });
}

function updateTop100View() {
  const modeLabels = { total: 'Total', pvp: 'PvP', pve: 'PvE' };
  const monthLabel = formatMonthLabel(getCurrentMonthKey());
  el.top100Title.textContent = `Top 100 — ${monthLabel} (${modeLabels[topMode] || 'Total'})`;
  const search = (el.top100Search?.value || '').trim().toLowerCase();
  if (search) {
    top100List = computeTopVictims(rawDeaths, topMode, Infinity).filter(
      (v) =>
        (v.name || '').toLowerCase().includes(search) ||
        (v.vocation || '').toLowerCase().includes(search) ||
        (v.lastKillers || []).some((k) => k.toLowerCase().includes(search))
    );
  } else {
    top100List = computeTopVictims(rawDeaths, topMode, 100);
  }
  renderTop100Table();
}

function renderHallCategory(title, items) {
  const listHtml =
    items && items.length > 0
      ? items
          .map((item, idx) => {
            const pos = idx + 1;
            const charUrl = `https://www.tibia.com/community/?name=${encodeURIComponent(item.name)}`;
            return `
              <li class="hall-item">
                <span>
                  <span class="rank-badge rank-${pos}">#${pos}</span>
                  <a class="char-link" href="${charUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name)}</a>
                </span>
                <span class="death-count-pill">${item.count}</span>
              </li>
            `;
          })
          .join('')
      : '<li class="hall-item"><span style="color:var(--tibia-brown-muted)">Sem registros</span></li>';

  return `
    <div class="hall-category">
      <div class="hall-category-title">${title}</div>
      <ol class="hall-list">${listHtml}</ol>
    </div>
  `;
}

function renderHallOfFame(hallList = allHallList) {
  if (!hallList || hallList.length === 0) {
    el.hallContainer.innerHTML =
      '<p class="empty-cell">O Hall da Fama guarda os Top 3 ao final de cada mês.</p>';
    return;
  }

  const search = (el.hallSearch?.value || '').trim().toLowerCase();
  const filtered = search
    ? hallList.filter((entry) => {
        const label = formatMonthLabel(entry.month).toLowerCase();
        const inMonth = label.includes(search) || (entry.month || '').toLowerCase().includes(search);
        const allPlayers = [...(entry.total || []), ...(entry.pvp || []), ...(entry.pve || [])];
        const inPlayers = allPlayers.some((p) => (p.name || '').toLowerCase().includes(search));
        return inMonth || inPlayers;
      })
    : hallList;

  if (filtered.length === 0) {
    el.hallContainer.innerHTML =
      '<p class="empty-cell">Nenhum registro encontrado para essa busca.</p>';
    return;
  }

  el.hallContainer.innerHTML = filtered
    .map(
      (entry) => `
      <div class="hall-month-card">
        <div class="hall-month-header">
          <span>${escapeHtml(formatMonthLabel(entry.month))}</span>
          <span class="hall-month-total">${entry.totalDeaths || 0} mortes no mês</span>
        </div>
        <div class="hall-columns">
          ${renderHallCategory('Top 3 Total', entry.total)}
          ${renderHallCategory('Top 3 PvP', entry.pvp)}
          ${renderHallCategory('Top 3 PvE', entry.pve)}
        </div>
      </div>
    `
    )
    .join('');
}

function renderCreaturesList() {
  const modeLabels = { total: 'Total', pvp: 'PvP', pve: 'PvE' };
  if (el.creaturesTitle) {
    el.creaturesTitle.textContent = `Mais Letais (${modeLabels[creaturesMode] || 'Total'})`;
  }
  const source = allCreaturesByMode[creaturesMode] || allCreaturesByMode.total || [];
  const search = (el.creaturesSearch?.value || '').trim().toLowerCase();
  const list = search
    ? source.filter((c) => (c.name || '').toLowerCase().includes(search))
    : source.slice(0, 15);

  if (list.length === 0) {
    el.rankingCreatures.innerHTML = `<li class="ranking-item"><span>${
      search ? 'Nenhum resultado encontrado' : 'Sem dados ainda'
    }</span></li>`;
  } else {
    el.rankingCreatures.innerHTML = list
      .map(
        (c, idx) => `
        <li class="ranking-item">
          <span>#${c.rank || idx + 1} ${escapeHtml(c.name)}</span>
          <span class="ranking-count">${c.count}</span>
        </li>
      `
      )
      .join('');
  }
}

function renderRankings(stats) {
  allCreaturesByMode = {
    total: stats.allCreatures || stats.topCreatures || [],
    pvp: stats.allCreaturesPvp || [],
    pve: stats.allCreaturesPve || [],
  };
  updateTop100View();
  renderCreaturesList();
  renderStatsTab();
}

function normalizeVocationGroup(voc) {
  const v = (voc || '').toLowerCase();
  if (v.includes('knight')) return 'Knight / EK';
  if (v.includes('paladin')) return 'Paladin / RP';
  if (v.includes('sorcerer')) return 'Sorcerer / MS';
  if (v.includes('druid')) return 'Druid / ED';
  if (v.includes('monk')) return 'Monk / EM';
  return voc || 'Desconhecida';
}

function renderStatsTab() {
  if (!el.statsChartSvg) return;

  const modeLabels = { total: 'Total', pvp: 'PvP', pve: 'PvE' };
  const monthKey = getCurrentMonthKey();
  const [yearNum, monthNum] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate();
  const now = new Date();
  const isSameMonth = now.getUTCFullYear() === yearNum && now.getUTCMonth() + 1 === monthNum;
  const elapsedDays = isSameMonth ? Math.max(1, now.getUTCDate()) : daysInMonth;

  el.statsTitle.textContent = `Estatísticas & Projeção — ${formatMonthLabel(monthKey)} (${modeLabels[statsMode] || 'Total'})`;

  const allMonthDeaths = rawDeaths;
  const pvpCountAll = allMonthDeaths.filter(isDeathPvP).length;
  const pveCountAll = allMonthDeaths.length - pvpCountAll;
  const pvpPct = allMonthDeaths.length > 0 ? Math.round((pvpCountAll / allMonthDeaths.length) * 100) : 0;
  const pvePct = allMonthDeaths.length > 0 ? 100 - pvpPct : 0;

  el.statsSplit.textContent = `${pvpPct}% / ${pvePct}%`;
  el.statsSplitSub.textContent = `${pvpCountAll} PvP • ${pveCountAll} PvE`;

  const filtered =
    statsMode === 'pvp'
      ? allMonthDeaths.filter(isDeathPvP)
      : statsMode === 'pve'
        ? allMonthDeaths.filter((d) => !isDeathPvP(d))
        : allMonthDeaths;

  const daily = Array(daysInMonth + 1).fill(0);
  for (const d of filtered) {
    if (!d.time) continue;
    const day = Number(String(d.time).slice(8, 10));
    if (day >= 1 && day <= daysInMonth) {
      daily[day]++;
    }
  }

  const totalSoFar = filtered.length;
  const avgPerDay = totalSoFar / elapsedDays;
  const remainingDays = Math.max(0, daysInMonth - elapsedDays);
  const projectedEnd = Math.round(totalSoFar + avgPerDay * remainingDays);

  // Recent 7-day pace for comparison
  const recentWindow = Math.min(7, elapsedDays);
  let recentSum = 0;
  for (let d = elapsedDays - recentWindow + 1; d <= elapsedDays; d++) {
    recentSum += daily[d];
  }
  const recentAvg = recentSum / recentWindow;

  let peakDay = 1;
  let peakVal = 0;
  for (let d = 1; d <= elapsedDays; d++) {
    if (daily[d] >= peakVal) {
      peakVal = daily[d];
      peakDay = d;
    }
  }

  el.statsAvgDay.textContent = `${avgPerDay.toFixed(1)} / dia`;
  el.statsAvgSub.textContent = `Últimos ${recentWindow}d: ${recentAvg.toFixed(1)} / dia`;

  if (peakVal > 0) {
    const dd = String(peakDay).padStart(2, '0');
    const mm = String(monthNum).padStart(2, '0');
    el.statsPeakDay.textContent = `${dd}/${mm}`;
    el.statsPeakCount.textContent = `${peakVal} ${peakVal === 1 ? 'morte' : 'mortes'}`;
  } else {
    el.statsPeakDay.textContent = '—';
    el.statsPeakCount.textContent = 'Sem dados';
  }

  el.statsProjection.textContent = `~${projectedEnd.toLocaleString('pt-BR')}`;
  el.statsProjectionSub.textContent =
    remainingDays > 0
      ? `+${Math.round(avgPerDay * remainingDays)} nos próximos ${remainingDays}d`
      : 'Mês encerrado';

  // Build cumulative arrays
  const cumReal = Array(daysInMonth + 1).fill(null);
  const cumProj = Array(daysInMonth + 1).fill(null);
  let acc = 0;
  for (let d = 1; d <= elapsedDays; d++) {
    acc += daily[d];
    cumReal[d] = acc;
  }
  cumProj[elapsedDays] = acc;
  for (let d = elapsedDays + 1; d <= daysInMonth; d++) {
    cumProj[d] = Math.round(acc + avgPerDay * (d - elapsedDays));
  }

  // SVG Chart dimensions
  const W = 760;
  const H = 320;
  const padL = 44;
  const padR = 54;
  const padT = 22;
  const padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxDaily = Math.max(5, Math.ceil(Math.max(...daily.slice(1), avgPerDay) * 1.15));
  const maxCum = Math.max(10, Math.ceil(Math.max(projectedEnd, acc) * 1.1));

  const stepX = plotW / daysInMonth;
  const barW = Math.max(6, stepX * 0.64);
  const xCenter = (d) => padL + (d - 0.5) * stepX;
  const yDaily = (v) => padT + plotH - (v / maxDaily) * plotH;
  const yCum = (v) => padT + plotH - (v / maxCum) * plotH;

  let svgParts = [];

  // Horizontal grid + Y labels (left = daily, right = cumulative)
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const frac = i / ticks;
    const y = padT + plotH - frac * plotH;
    const leftVal = Math.round(frac * maxDaily);
    const rightVal = Math.round(frac * maxCum);
    svgParts.push(
      `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#d9c6a8" stroke-width="1" />`
    );
    svgParts.push(
      `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#7a5c3e">${leftVal}</text>`
    );
    svgParts.push(
      `<text x="${W - padR + 6}" y="${y + 4}" text-anchor="start" font-size="10" fill="#004294">${rightVal}</text>`
    );
  }

  // Axes
  svgParts.push(
    `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#7a5c3e" stroke-width="1.2" />`
  );

  // Today divider
  if (elapsedDays < daysInMonth) {
    const todayX = padL + elapsedDays * stepX;
    svgParts.push(
      `<line x1="${todayX}" y1="${padT}" x2="${todayX}" y2="${padT + plotH}" stroke="#9e8260" stroke-width="1" stroke-dasharray="4 3" />`
    );
    svgParts.push(
      `<text x="${todayX + 4}" y="${padT + 10}" font-size="10" font-weight="bold" fill="#7a5c3e">Projeção →</text>`
    );
  }

  // Daily bars (real + projected)
  for (let d = 1; d <= daysInMonth; d++) {
    const isProj = d > elapsedDays;
    const val = isProj ? avgPerDay : daily[d];
    const h = Math.max(0, (val / maxDaily) * plotH);
    const x = xCenter(d) - barW / 2;
    const y = padT + plotH - h;

    if (isProj) {
      svgParts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(158, 42, 43, 0.2)" stroke="#9e2a2b" stroke-width="1" stroke-dasharray="2 2" />`
      );
    } else {
      svgParts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="#9e2a2b" opacity="0.82" />`
      );
    }

    // X-axis labels every 2 days (and day 1 / last day)
    if (d === 1 || d === daysInMonth || d % 2 === 0) {
      svgParts.push(
        `<text x="${xCenter(d).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="10" fill="#5a3818">${d}</text>`
      );
    }
  }

  // Cumulative real line
  const realPoints = [];
  for (let d = 1; d <= elapsedDays; d++) {
    realPoints.push(`${xCenter(d).toFixed(1)},${yCum(cumReal[d]).toFixed(1)}`);
  }
  if (realPoints.length > 0) {
    svgParts.push(
      `<polyline fill="none" stroke="#004294" stroke-width="2.5" points="${realPoints.join(' ')}" />`
    );
    for (let d = 1; d <= elapsedDays; d++) {
      svgParts.push(
        `<circle cx="${xCenter(d).toFixed(1)}" cy="${yCum(cumReal[d]).toFixed(1)}" r="2.8" fill="#004294" />`
      );
    }
  }

  // Cumulative projection line
  if (elapsedDays < daysInMonth) {
    const projPoints = [];
    for (let d = elapsedDays; d <= daysInMonth; d++) {
      projPoints.push(`${xCenter(d).toFixed(1)},${yCum(cumProj[d]).toFixed(1)}`);
    }
    svgParts.push(
      `<polyline fill="none" stroke="#c87400" stroke-width="2.5" stroke-dasharray="6 4" points="${projPoints.join(' ')}" />`
    );
    const endX = xCenter(daysInMonth);
    const endY = yCum(cumProj[daysInMonth]);
    svgParts.push(
      `<circle cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="4" fill="#c87400" stroke="#ffffff" stroke-width="1.5" />`
    );
  }

  // Invisible hover hit areas for tooltips
  for (let d = 1; d <= daysInMonth; d++) {
    const x = padL + (d - 1) * stepX;
    const isProj = d > elapsedDays;
    const dayVal = isProj ? avgPerDay.toFixed(1) : daily[d];
    const cumVal = isProj ? cumProj[d] : cumReal[d];
    svgParts.push(
      `<rect class="chart-hover-col" data-day="${d}" data-proj="${isProj ? '1' : '0'}" data-daily="${dayVal}" data-cum="${cumVal}" x="${x.toFixed(1)}" y="${padT}" width="${stepX.toFixed(1)}" height="${plotH}" fill="transparent" style="cursor:crosshair" />`
    );
  }

  el.statsChartSvg.innerHTML = svgParts.join('');

  // Bind tooltip events
  const mmStr = String(monthNum).padStart(2, '0');
  el.statsChartSvg.querySelectorAll('.chart-hover-col').forEach((col) => {
    col.addEventListener('mouseenter', () => {
      const d = String(col.dataset.day).padStart(2, '0');
      const isProj = col.dataset.proj === '1';
      el.statsTooltip.innerHTML = `
        <strong>Dia ${d}/${mmStr}${isProj ? ' (Projeção)' : ''}</strong><br/>
        No dia: ${col.dataset.daily} ${isProj ? '(média)' : 'mortes'}<br/>
        Acumulado: ${col.dataset.cum} mortes
      `;
      el.statsTooltip.classList.remove('hidden');
    });
    col.addEventListener('mousemove', (ev) => {
      const rect = el.statsChartWrap.getBoundingClientRect();
      let left = ev.clientX - rect.left + 12;
      let top = ev.clientY - rect.top - 10;
      if (left + 170 > rect.width) left = ev.clientX - rect.left - 175;
      if (top < 6) top = 6;
      el.statsTooltip.style.left = `${left}px`;
      el.statsTooltip.style.top = `${top}px`;
    });
    col.addEventListener('mouseleave', () => {
      el.statsTooltip.classList.add('hidden');
    });
  });

  // Vocation breakdown
  const byVoc = new Map();
  for (const d of filtered) {
    const group = normalizeVocationGroup(d.vocation);
    byVoc.set(group, (byVoc.get(group) || 0) + 1);
  }
  const vocList = Array.from(byVoc.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  if (vocList.length === 0) {
    el.statsVocationBars.innerHTML = '<p class="empty-cell">Sem dados ainda.</p>';
  } else {
    const maxVoc = vocList[0].count;
    el.statsVocationBars.innerHTML = vocList
      .map((v) => {
        const pct = totalSoFar > 0 ? Math.round((v.count / totalSoFar) * 100) : 0;
        const width = Math.max(4, Math.round((v.count / maxVoc) * 100));
        return `
          <div class="vocation-row">
            <span class="vocation-name">${escapeHtml(v.name)}</span>
            <div class="vocation-bar-track">
              <div class="vocation-bar-fill" style="width:${width}%"></div>
            </div>
            <span class="vocation-count">${v.count} (${pct}%)</span>
          </div>
        `;
      })
      .join('');
  }
}

el.top100Prev.addEventListener('click', () => {
  if (topCurrentPage > 1) {
    topCurrentPage--;
    renderTop100Table();
  }
});

el.top100Next.addEventListener('click', () => {
  const totalPages = Math.ceil(top100List.length / TOP_PAGE_SIZE);
  if (topCurrentPage < totalPages) {
    topCurrentPage++;
    renderTop100Table();
  }
});

let top100SearchDebounce = null;
el.top100Search.addEventListener('input', () => {
  clearTimeout(top100SearchDebounce);
  top100SearchDebounce = setTimeout(() => {
    topCurrentPage = 1;
    updateTop100View();
  }, 150);
});

let searchDebounce = null;
el.filterSearch.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(applyFilters, 150);
});
el.filterVocation.addEventListener('change', applyFilters);
el.filterSort.addEventListener('change', applyFilters);

let creaturesSearchDebounce = null;
el.creaturesSearch.addEventListener('input', () => {
  clearTimeout(creaturesSearchDebounce);
  creaturesSearchDebounce = setTimeout(renderCreaturesList, 150);
});

let hallSearchDebounce = null;
el.hallSearch.addEventListener('input', () => {
  clearTimeout(hallSearchDebounce);
  hallSearchDebounce = setTimeout(() => renderHallOfFame(allHallList), 150);
});

document.querySelectorAll('.mode-btn[data-top-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn[data-top-mode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    topMode = btn.dataset.topMode;
    topCurrentPage = 1;
    updateTop100View();
  });
});

document.querySelectorAll('.creatures-mode-btn[data-creatures-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.creatures-mode-btn[data-creatures-mode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    creaturesMode = btn.dataset.creaturesMode;
    renderCreaturesList();
  });
});

document.querySelectorAll('.stats-mode-btn[data-stats-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.stats-mode-btn[data-stats-mode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    statsMode = btn.dataset.statsMode;
    renderStatsTab();
  });
});

document.querySelectorAll('.tab').forEach((tabBtn) => {
  tabBtn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tabBtn.classList.add('active');
    document.getElementById(`tab-${tabBtn.dataset.tab}`).classList.add('active');
  });
});

async function updateVisitorCounter() {
  try {
    const key = 'insanity_visit_counted';
    const alreadyCounted = sessionStorage.getItem(key) === '1';
    const endpoint = alreadyCounted
      ? 'https://abacus.jasoncameron.dev/get/insanity-deaths/visits'
      : 'https://abacus.jasoncameron.dev/hit/insanity-deaths/visits';
    const res = await fetch(endpoint);
    if (res.ok) {
      const data = await res.json();
      if (typeof data.value === 'number') {
        el.statVisitors.textContent = data.value.toLocaleString('pt-BR');
        if (!alreadyCounted) sessionStorage.setItem(key, '1');
      }
    }
  } catch {}
}

updateVisitorCounter();
loadData();
