const PAGE_SIZE = 50;
const TOP_PAGE_SIZE = 10;

let rawDeaths = [];
let allDeaths = [];
let top100List = [];
let currentPage = 1;
let topCurrentPage = 1;
let topMode = 'total';
let pollTimer = null;

const el = {
  guildMeta: document.getElementById('guild-meta'),
  top100Title: document.getElementById('top100-title'),
  statTotal: document.getElementById('stat-total'),
  stat24h: document.getElementById('stat-24h'),
  stat7d: document.getElementById('stat-7d'),
  statVisitors: document.getElementById('stat-visitors'),
  statTopVictim: document.getElementById('stat-top-victim'),
  statTopVictimCount: document.getElementById('stat-top-victim-count'),
  statTopCreature: document.getElementById('stat-top-creature'),
  statTopCreatureCount: document.getElementById('stat-top-creature-count'),
  filterSearch: document.getElementById('filter-search'),
  filterVocation: document.getElementById('filter-vocation'),
  filterSort: document.getElementById('filter-sort'),
  deathsTbody: document.getElementById('deaths-tbody'),
  top100Tbody: document.getElementById('top100-tbody'),
  top100Prev: document.getElementById('top100-prev'),
  top100Next: document.getElementById('top100-next'),
  top100Range: document.getElementById('top100-range'),
  top100PaginationTop: document.getElementById('top100-pagination-top'),
  top100Pagination: document.getElementById('top100-pagination'),
  pagination: document.getElementById('pagination'),
  rankingCreatures: document.getElementById('ranking-creatures'),
  hallContainer: document.getElementById('hall-container'),
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

function computeTopVictims(deaths, mode = 'total') {
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

  return Array.from(byPlayer.values())
    .sort((a, b) => b.count - a.count || new Date(b.lastDeath).getTime() - new Date(a.lastDeath).getTime())
    .slice(0, 100);
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

  for (const d of sorted) {
    const ts = new Date(d.time).getTime();
    if (ts >= oneDayAgo) deaths24h++;
    if (ts >= sevenDaysAgo) deaths7d++;

    for (const k of d.killers || []) {
      byCreature.set(k, (byCreature.get(k) || 0) + 1);
    }
  }

  const topVictims = computeTopVictims(sorted, 'total');

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

async function loadData() {
  try {
    const bust = Date.now();
    const [deathsRes, metaRes, hallRes] = await Promise.all([
      fetch(`/data/deaths.json?t=${bust}`),
      fetch(`/data/meta.json?t=${bust}`),
      fetch(`/data/hall-of-fame.json?t=${bust}`),
    ]);

    const currentMonth = getCurrentMonthKey();

    if (deathsRes.ok) {
      const parsed = await deathsRes.json();
      const list = Array.isArray(parsed) ? parsed : [];
      rawDeaths = list.filter((d) => (d.time || '').slice(0, 7) === currentMonth);
    }

    let hallList = [];
    if (hallRes.ok) {
      const parsedHall = await hallRes.json();
      if (Array.isArray(parsedHall)) hallList = parsedHall;
    }

    if (metaRes.ok) {
      const meta = await metaRes.json();
      const worldText = meta.world || '';
      const membersText = meta.membersCount ? `${meta.membersCount} membros` : '';
      const lastSync =
        meta.lastFullSync && meta.lastOnlineSync
          ? new Date(meta.lastFullSync) > new Date(meta.lastOnlineSync)
            ? meta.lastFullSync
            : meta.lastOnlineSync
          : meta.lastFullSync || meta.lastOnlineSync;
      const syncText = lastSync ? `Última atualização: ${formatDateTime(lastSync)}` : '';
      el.guildMeta.textContent = [worldText, membersText, syncText].filter(Boolean).join(' • ');
    }

    const stats = computeStats(rawDeaths);
    renderStats(stats);
    applyFilters();
    renderHallOfFame(hallList);
  } catch (err) {
    console.error('Erro ao carregar dados:', err);
  } finally {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(loadData, 60000);
  }
}

function renderStats(stats) {
  el.statTotal.textContent = stats.totalDeaths;
  el.stat24h.textContent = stats.deaths24h;
  el.stat7d.textContent = stats.deaths7d;

  if (stats.topVictims.length > 0) {
    const top = stats.topVictims[0];
    el.statTopVictim.textContent = top.name;
    el.statTopVictimCount.textContent = `${top.count} mortes`;
  } else {
    el.statTopVictim.textContent = '—';
    el.statTopVictimCount.textContent = '—';
  }

  if (stats.topCreatures.length > 0) {
    const topC = stats.topCreatures[0];
    el.statTopCreature.textContent = topC.name;
    el.statTopCreatureCount.textContent = `${topC.count} abates`;
  } else {
    el.statTopCreature.textContent = '—';
    el.statTopCreatureCount.textContent = '—';
  }

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
      const pos = start + idx + 1;
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
  top100List = computeTopVictims(rawDeaths, topMode);
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

function renderHallOfFame(hallList) {
  if (!hallList || hallList.length === 0) {
    el.hallContainer.innerHTML =
      '<p class="empty-cell">O Hall da Fama guarda os Top 3 ao final de cada mês.</p>';
    return;
  }

  el.hallContainer.innerHTML = hallList
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

function renderRankings(stats) {
  updateTop100View();

  if (stats.topCreatures.length === 0) {
    el.rankingCreatures.innerHTML = '<li class="ranking-item"><span>Sem dados ainda</span></li>';
  } else {
    el.rankingCreatures.innerHTML = stats.topCreatures
      .map(
        (c, idx) => `
        <li class="ranking-item">
          <span>#${idx + 1} ${escapeHtml(c.name)}</span>
          <span class="ranking-count">${c.count}</span>
        </li>
      `
      )
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

let searchDebounce = null;
el.filterSearch.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(applyFilters, 150);
});
el.filterVocation.addEventListener('change', applyFilters);
el.filterSort.addEventListener('change', applyFilters);

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    topMode = btn.dataset.topMode;
    topCurrentPage = 1;
    updateTop100View();
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
