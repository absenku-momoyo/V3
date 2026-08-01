// Dashboard rendering: headline stats, aggregate trend, ranked tables,
// and per-outlet small multiples.
import { requireSession, logout } from './auth.js';
import { fetchOutlets, fetchDailyReportsForMonth, fetchRankingForDate, fetchLastUpdated } from './data.js';
import {
  computeMonthlySummary,
  pickDefaultRankingDate,
  buildTrendSeries,
  computeHeadlineStats,
  computeMoMComparison,
  computeCashOnlineSplit,
  formatRupiahCompact,
  formatRupiahFull,
  formatUpdatedAtWIB,
} from './lib/computations.mjs';

const monthSelect = document.getElementById('month-select');
const rankingDateInput = document.getElementById('ranking-date');
const rankingPanel = document.getElementById('ranking-panel');
const logoutBtn = document.getElementById('logout-btn');
const mainEl = document.getElementById('main');
const toastEl = document.getElementById('toast');

let outlets = [];
let currentYear;
let currentMonth;
const charts = new Map();

// Kept between loads so the ranking toggle and the outlet modal can re-render
// without re-fetching.
let currentDailyRows = [];
let rankingMode = 'harian';          // 'harian' | 'bulanan'
let lastDefaultDate = null;          // latest date with data in the loaded month
const seriesByOutlet = new Map();    // outlet_id -> trend series (for the modal)

// ---------- theme-aware chart ink ----------
// Chart.js needs concrete colors, so read them from the CSS custom properties
// rather than duplicating hexes here — one source of truth, and dark mode
// stays correct because the same tokens flip.
const cssVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
const ink = () => ({
  brand: cssVar('--brand'),
  grid: cssVar('--grid'),
  muted: cssVar('--ink-muted'),
  ink: cssVar('--ink'),
  surface: cssVar('--surface'),
  hairline: cssVar('--hairline'),
});

const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const fmtDateLong = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
};

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, 5000);
}

// ---------- month picker ----------
function monthOptions() {
  const now = new Date();
  const options = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  return options;
}

function populateMonthSelect() {
  const options = monthOptions();
  monthSelect.innerHTML = '';
  options.forEach((opt) => {
    const el = document.createElement('option');
    el.value = `${opt.year}-${opt.month}`;
    el.textContent = opt.label;
    monthSelect.appendChild(el);
  });
  currentYear = options[0].year;
  currentMonth = options[0].month;
  monthSelect.value = `${currentYear}-${currentMonth}`;
}

// ---------- skeletons ----------
function setLoading(isLoading) {
  mainEl.dataset.state = isLoading ? 'loading' : 'ready';
  if (!isLoading) return;

  ['stat-total', 'stat-avg', 'stat-best', 'stat-mom'].forEach((id) => {
    document.getElementById(id).innerHTML = '<span class="skeleton skeleton--value"></span>';
  });
  ['stat-total-sub', 'stat-avg-sub', 'stat-best-sub', 'stat-mom-sub'].forEach((id) => {
    document.getElementById(id).innerHTML = '<span class="skeleton skeleton--sub"></span>';
  });

  skeletonRows('#ranking-table tbody', 6, 4);

  const grid = document.getElementById('trend-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const card = document.createElement('div');
    card.className = 'trend-card';
    card.innerHTML =
      '<div class="trend-card-head"><span class="skeleton" style="width:58%"></span></div>' +
      '<div class="spark-frame"><span class="skeleton" style="height:100%;border-radius:9px"></span></div>';
    grid.appendChild(card);
  }
}

function skeletonRows(selector, rowCount, colCount) {
  const tbody = document.querySelector(selector);
  tbody.innerHTML = '';
  for (let i = 0; i < rowCount; i++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < colCount; c++) {
      const td = document.createElement('td');
      td.innerHTML = '<span class="skeleton skeleton--row"></span>';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

// ---------- headline stats ----------
function renderStats(stats, mom, monthLabel) {
  const set = (id, html) => { document.getElementById(id).innerHTML = html; };

  set('stat-total', formatRupiahCompact(stats.grandTotal));
  set('stat-total-sub', stats.activeDays
    ? `${formatRupiahFull(stats.grandTotal)} · ${stats.activeDays} hari · ${monthLabel}`
    : `Belum ada data untuk ${monthLabel}`);

  set('stat-avg', formatRupiahCompact(stats.avgPerDay));
  set('stat-avg-sub', stats.activeDays
    ? `Rata-rata dari ${stats.activeDays} hari berjalan`
    : '—');

  if (stats.bestOutlet) {
    set('stat-best', escapeHtml(stats.bestOutlet.outlet_name));
    set('stat-best-sub', `${formatRupiahCompact(stats.bestOutlet.total)} · ${
      stats.grandTotal ? Math.round((stats.bestOutlet.total / stats.grandTotal) * 100) : 0
    }% dari total`);
  } else {
    set('stat-best', '—');
    set('stat-best-sub', 'Belum ada data');
  }

  if (mom.percent === null) {
    set('stat-mom', '—');
    set('stat-mom-sub', mom.prevTotal === 0
      ? 'Tidak ada data bulan lalu sebagai pembanding'
      : 'Belum ada data bulan ini');
  } else {
    const up = mom.percent >= 0;
    const cls = up ? 'delta--up' : 'delta--down';
    const arrow = up ? '▲' : '▼';
    set('stat-mom',
      `<span class="delta ${cls}"><i class="delta-icon">${arrow}</i>${
        Math.abs(mom.percent).toFixed(1).replace('.', ',')}%</span>`);
    // Say explicitly that the baseline was truncated to the same span —
    // otherwise a part-month vs full-month gap reads as a real collapse.
    set('stat-mom-sub',
      `${formatRupiahCompact(mom.currentTotal)} vs ${formatRupiahCompact(mom.prevTotal)} ` +
      `(bulan lalu s/d tgl ${mom.throughDay})`);
  }
}

// ---------- aggregate trend ----------
function dailyTotals(dailyRows, year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const byDate = new Map();
  dailyRows.forEach((r) => {
    byDate.set(r.report_date, (byDate.get(r.report_date) || 0) + r.omzet);
  });
  const points = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    points.push({ date: iso, day: d, omzet: byDate.has(iso) ? byDate.get(iso) : null });
  }
  return points;
}

// Vertical crosshair on hover — the line/area interaction the dataviz spec
// expects, drawn under the dataset so it never obscures the mark.
const crosshairPlugin = {
  id: 'crosshair',
  beforeDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.() || [];
    if (!active.length) return;
    const { ctx, chartArea } = chart;
    const x = active[0].element.x;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = chart.$crosshairColor || 'rgba(0,0,0,.2)';
    ctx.stroke();
    ctx.restore();
  },
};

function areaGradient(ctx, chartArea, color) {
  if (!chartArea) return 'transparent';
  const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  g.addColorStop(0, hexToRgba(color, 0.28));
  g.addColorStop(1, hexToRgba(color, 0.02));
  return g;
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '').trim();
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function renderTotalTrend(dailyRows) {
  const c = ink();
  const points = dailyTotals(dailyRows, currentYear, currentMonth);
  const canvas = document.getElementById('chart-total');

  destroyChart('total');

  const hasData = points.some((p) => p.omzet !== null);
  document.getElementById('trend-total-note').textContent = hasData
    ? 'Gabungan semua outlet · arahkan kursor untuk detail harian'
    : 'Belum ada data untuk periode ini';
  if (!hasData) { clearCanvas(canvas); return; }

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: points.map((p) => p.day),
      datasets: [{
        label: 'Omzet harian',
        data: points.map((p) => p.omzet),
        borderColor: c.brand,
        borderWidth: 2,
        spanGaps: false,
        tension: 0.32,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: c.brand,
        pointHoverBorderColor: c.surface,
        pointHoverBorderWidth: 2,
        fill: true,
        backgroundColor: (ctx) => areaGradient(ctx.chart.ctx, ctx.chart.chartArea, c.brand),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 6 } },
      plugins: {
        legend: { display: false }, // single series — the panel title names it
        tooltip: tooltipConfig(c, points),
      },
      scales: {
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: c.grid, drawTicks: false },
          ticks: {
            color: c.muted,
            font: { family: fontUI(), size: 11 },
            padding: 8,
            maxTicksLimit: 5,
            callback: (v) => formatRupiahCompact(v),
          },
        },
        x: {
          border: { color: c.hairline },
          grid: { display: false },
          ticks: {
            color: c.muted,
            font: { family: fontUI(), size: 11 },
            autoSkip: true,
            maxTicksLimit: 12,
            maxRotation: 0,
          },
        },
      },
    },
    plugins: [crosshairPlugin],
  });
  chart.$crosshairColor = hexToRgba(c.brand, 0.35);
  charts.set('total', chart);
}

function tooltipConfig(c, points) {
  return {
    backgroundColor: c.ink,
    titleColor: c.surface,
    bodyColor: c.surface,
    borderColor: 'transparent',
    padding: 11,
    cornerRadius: 8,
    displayColors: false,
    titleFont: { family: fontUI(), size: 12, weight: '700' },
    bodyFont: { family: fontUI(), size: 13 },
    callbacks: {
      title: (items) => {
        const p = points[items[0].dataIndex];
        return fmtDateLong(p.date);
      },
      label: (item) => formatRupiahFull(item.parsed.y),
    },
  };
}

const fontUI = () => '"Plus Jakarta Sans", system-ui, sans-serif';

function clearCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function destroyChart(key) {
  const existing = charts.get(key);
  if (existing) { existing.destroy(); charts.delete(key); }
}

function destroyAllCharts() {
  charts.forEach((ch) => ch.destroy());
  charts.clear();
}

// ---------- tables ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function emptyRow(tbody, colspan, message) {
  tbody.innerHTML = `<tr class="empty-row"><td colspan="${colspan}">${escapeHtml(message)}</td></tr>`;
}

// Shared row builder: rank badge, outlet name, right-aligned tabular figure,
// and a proportion bar scaled against the largest value in the set.
function buildRankedRows(tbody, rows, maxValue, totalValue) {
  tbody.innerHTML = '';
  rows.forEach((row, i) => {
    const pctOfMax = maxValue > 0 ? (row.value / maxValue) * 100 : 0;
    const pctOfTotal = totalValue > 0 ? (row.value / totalValue) * 100 : 0;
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td class="col-rank"><span class="rank-badge">${row.rank ?? i + 1}</span></td>` +
      `<td><div class="outlet-cell"><span class="outlet-name">${escapeHtml(row.name)}</span>` +
        (row.brand ? `<span class="brand-tag">${escapeHtml(row.brand)}</span>` : '') +
      `</div></td>` +
      `<td class="col-num" title="${escapeHtml(formatRupiahFull(row.value))}">${
        formatRupiahCompact(row.value)}</td>` +
      `<td class="col-share"><div class="share-cell">` +
        `<div class="bar"><div class="bar-fill" style="width:${pctOfMax.toFixed(1)}%;animation-delay:${
          Math.min(i * 22, 200)}ms"></div></div>` +
        `<span class="share-pct">${pctOfTotal.toFixed(1).replace('.', ',')}%</span>` +
      `</div></td>`;
    tbody.appendChild(tr);
  });
}

// One panel, two modes. The toggle swaps between a monthly leaderboard
// (summed from the already-loaded rows) and a single-day ranking (fetched
// from the ranking view). Column header + note adapt to the mode.
function applyRankingMode() {
  rankingPanel.dataset.mode = rankingMode;
  document.getElementById('seg-harian').classList.toggle('is-active', rankingMode === 'harian');
  document.getElementById('seg-bulanan').classList.toggle('is-active', rankingMode === 'bulanan');
  document.getElementById('seg-harian').setAttribute('aria-selected', String(rankingMode === 'harian'));
  document.getElementById('seg-bulanan').setAttribute('aria-selected', String(rankingMode === 'bulanan'));

  if (rankingMode === 'bulanan') {
    renderRankingBulanan();
  } else if (rankingDateInput.value) {
    renderRankingHarian(rankingDateInput.value);
  } else {
    const note = document.getElementById('ranking-note');
    note.textContent = 'Belum ada data pada periode ini';
    emptyRow(document.querySelector('#ranking-table tbody'), 4,
      'Belum ada data omzet untuk periode ini.');
  }
}

function renderRankingBulanan() {
  const { rows, grandTotal } = computeMonthlySummary(currentDailyRows, outlets);
  const tbody = document.querySelector('#ranking-table tbody');
  document.getElementById('ranking-value-head').textContent = 'Total Omzet';
  const note = document.getElementById('ranking-note');
  const monthLabel = `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;
  if (!rows.length || grandTotal === 0) {
    note.textContent = `Total per outlet · ${monthLabel}`;
    emptyRow(tbody, 4, 'Belum ada data omzet untuk periode ini.');
    return;
  }
  note.textContent = `Total per outlet · ${monthLabel}`;
  const max = rows[0].total;
  buildRankedRows(tbody, rows.map((r) => ({
    name: r.outlet_name,
    value: r.total,
  })), max, grandTotal);
}

async function renderRankingHarian(dateStr) {
  const tbody = document.querySelector('#ranking-table tbody');
  const note = document.getElementById('ranking-note');
  document.getElementById('ranking-value-head').textContent = 'Omzet';
  try {
    const ranking = await fetchRankingForDate(dateStr);
    // Guard against a stale response if the user toggled/changed date meanwhile.
    if (rankingMode !== 'harian') return;
    if (!ranking.length) {
      note.textContent = `Tidak ada data untuk ${fmtDateLong(dateStr)}`;
      emptyRow(tbody, 4, 'Tidak ada outlet yang melaporkan omzet pada tanggal ini.');
      return;
    }
    note.textContent = `Peringkat ${fmtDateLong(dateStr)} · ${ranking.length} outlet`;
    const total = ranking.reduce((s, r) => s + r.omzet, 0);
    const max = Math.max(...ranking.map((r) => r.omzet));
    buildRankedRows(tbody, ranking.map((r) => ({
      rank: r.peringkat,
      name: r.outlet_name,
      brand: r.brand,
      value: r.omzet,
    })), max, total);
  } catch (err) {
    note.textContent = 'Gagal memuat ranking';
    emptyRow(tbody, 4, 'Gagal memuat data ranking.');
    showToast(`Gagal memuat ranking: ${err.message}`);
  }
}

// ---------- small multiples ----------
function renderTrendGrid(dailyRows) {
  const c = ink();
  const series = buildTrendSeries(dailyRows, outlets, currentYear, currentMonth);
  const grid = document.getElementById('trend-grid');

  // destroy only the sparkline charts, keep the aggregate one
  Array.from(charts.keys())
    .filter((k) => k !== 'total' && k !== 'donut' && k !== 'modal')
    .forEach(destroyChart);
  grid.innerHTML = '';
  seriesByOutlet.clear();

  // Order the small multiples by monthly total so the grid reads top-down,
  // matching the ranking table rather than an arbitrary alphabetical order.
  const withTotals = series.map((s) => ({
    ...s,
    total: s.points.reduce((sum, p) => sum + (p.omzet || 0), 0),
    daysWithData: s.points.filter((p) => p.omzet !== null).length,
  })).sort((a, b) => b.total - a.total);

  withTotals.forEach((s) => {
    seriesByOutlet.set(s.outlet_id, s);
    const card = document.createElement('div');
    card.className = 'trend-card' + (s.daysWithData === 0 ? ' trend-card--empty' : '');

    // Cards with data are clickable → open the detail modal (Feature: drill-down)
    if (s.daysWithData > 0) {
      card.classList.add('trend-card--clickable');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Lihat detail ${s.outlet_name}`);
      card.addEventListener('click', () => openOutletModal(s.outlet_id));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOutletModal(s.outlet_id); }
      });
    }

    const head = document.createElement('div');
    head.className = 'trend-card-head';
    head.innerHTML =
      `<h3 title="${escapeHtml(s.outlet_name)}">${escapeHtml(s.outlet_name)}</h3>` +
      `<span class="trend-total">${formatRupiahCompact(s.total)}</span>`;
    card.appendChild(head);

    const meta = document.createElement('p');
    meta.className = 'trend-meta';
    meta.textContent = s.daysWithData
      ? `${s.daysWithData} hari · puncak ${formatRupiahCompact(
          Math.max(...s.points.map((p) => p.omzet || 0)))}`
      : 'Belum ada data';
    card.appendChild(meta);

    const frame = document.createElement('div');
    frame.className = 'spark-frame';
    card.appendChild(frame);
    grid.appendChild(card);

    if (s.daysWithData === 0) {
      frame.textContent = 'Tidak ada data';
      return;
    }

    const canvas = document.createElement('canvas');
    frame.appendChild(canvas);

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: s.points.map((p) => Number(p.date.slice(8, 10))),
        datasets: [{
          data: s.points.map((p) => p.omzet),
          borderColor: c.brand,
          borderWidth: 1.8,
          spanGaps: false,
          tension: 0.32,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: c.brand,
          pointHoverBorderColor: c.surface,
          pointHoverBorderWidth: 2,
          fill: true,
          backgroundColor: (ctx) => areaGradient(ctx.chart.ctx, ctx.chart.chartArea, c.brand),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltipConfig(c, s.points),
        },
        scales: {
          y: { display: false, beginAtZero: true },
          x: { display: false },
        },
      },
      plugins: [crosshairPlugin],
    });
    chart.$crosshairColor = hexToRgba(c.brand, 0.3);
    charts.set(`spark-${s.outlet_id}`, chart);
  });
}

// ---------- donut: tunai vs online ----------
// Tunai keeps the brand crimson; online is a muted slate. Two categories only,
// each direct-labelled with % and nominal, so identity never rests on color.
function renderDonut(dailyRows) {
  const c = ink();
  const split = computeCashOnlineSplit(dailyRows);
  const note = document.getElementById('donut-note');
  const legend = document.getElementById('donut-legend');
  const center = document.getElementById('donut-center');
  const canvas = document.getElementById('chart-donut');

  destroyChart('donut');

  if (!split.hasSplit || split.total === 0) {
    note.textContent = 'Rincian belum tersedia';
    center.innerHTML = '';
    canvas.style.display = 'none';
    legend.innerHTML =
      '<li class="donut-empty">Rincian tunai/online belum ada untuk periode ini. ' +
      'Jalankan pusher versi terbaru untuk mengisinya.</li>';
    return;
  }

  canvas.style.display = '';
  const onlineColor = cssVar('--ink-2');
  const tunaiColor = c.brand;
  const pct = (v) => (v / split.total) * 100;

  note.textContent = 'Komposisi pembayaran';
  center.innerHTML =
    '<span class="donut-center-label">Tunai</span>' +
    `<span class="donut-center-value">${pct(split.tunai).toFixed(0)}%</span>`;

  legend.innerHTML =
    `<li><span class="legend-swatch" style="background:${tunaiColor}"></span>` +
      `<span class="legend-name">Tunai (CASH)</span>` +
      `<span class="legend-value">${formatRupiahCompact(split.tunai)}<small>${
        pct(split.tunai).toFixed(1).replace('.', ',')}%</small></span></li>` +
    `<li><span class="legend-swatch" style="background:${onlineColor}"></span>` +
      `<span class="legend-name">Online (BCA, GRAB, GoFood, dll)</span>` +
      `<span class="legend-value">${formatRupiahCompact(split.online)}<small>${
        pct(split.online).toFixed(1).replace('.', ',')}%</small></span></li>`;

  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Tunai', 'Online'],
      datasets: [{
        data: [split.tunai, split.online],
        backgroundColor: [tunaiColor, onlineColor],
        borderColor: c.surface,
        borderWidth: 3,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c.ink,
          titleColor: c.surface,
          bodyColor: c.surface,
          padding: 11,
          cornerRadius: 8,
          displayColors: false,
          titleFont: { family: fontUI(), size: 12, weight: '700' },
          bodyFont: { family: fontUI(), size: 13 },
          callbacks: {
            label: (item) => `${formatRupiahFull(item.parsed)} · ${
              pct(item.parsed).toFixed(1).replace('.', ',')}%`,
          },
        },
      },
    },
  });
  charts.set('donut', chart);
}

// ---------- freshness ----------
async function renderFreshness() {
  const el = document.getElementById('freshness-text');
  const wrap = document.getElementById('freshness');
  try {
    const iso = await fetchLastUpdated();
    const formatted = formatUpdatedAtWIB(iso);
    if (!formatted) {
      wrap.classList.add('freshness--stale');
      el.textContent = 'Belum ada data tersimpan';
      return;
    }
    wrap.classList.remove('freshness--stale');
    el.innerHTML = `Data per <strong>${escapeHtml(formatted)}</strong> · diperbarui 2× sehari (23:00 &amp; 07:30)`;
  } catch (err) {
    wrap.classList.add('freshness--stale');
    el.textContent = 'Gagal memuat waktu pembaruan';
  }
}

// ---------- outlet detail modal ----------
const modal = document.getElementById('outlet-modal');

function openOutletModal(outletId) {
  const s = seriesByOutlet.get(outletId);
  if (!s) return;
  const c = ink();

  document.getElementById('modal-title').textContent = s.outlet_name;
  const monthLabel = `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;
  document.getElementById('modal-sub').textContent =
    `Omzet harian · ${monthLabel}`;

  const values = s.points.map((p) => p.omzet).filter((v) => v !== null);
  const total = values.reduce((sum, v) => sum + v, 0);
  const peak = values.length ? Math.max(...values) : 0;
  const avg = values.length ? total / values.length : 0;
  document.getElementById('modal-stats').innerHTML =
    statTile('Total', formatRupiahCompact(total)) +
    statTile('Rata-rata / hari', formatRupiahCompact(avg)) +
    statTile('Puncak', formatRupiahCompact(peak));

  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  destroyChart('modal');
  const canvas = document.getElementById('modal-chart');
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: s.points.map((p) => Number(p.date.slice(8, 10))),
      datasets: [{
        data: s.points.map((p) => p.omzet),
        borderColor: c.brand,
        borderWidth: 2.5,
        spanGaps: false,
        tension: 0.32,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: c.brand,
        pointHoverBorderColor: c.surface,
        pointHoverBorderWidth: 2,
        fill: true,
        backgroundColor: (ctx) => areaGradient(ctx.chart.ctx, ctx.chart.chartArea, c.brand),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: tooltipConfig(c, s.points) },
      scales: {
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: c.grid, drawTicks: false },
          ticks: { color: c.muted, font: { family: fontUI(), size: 11 }, padding: 8,
            maxTicksLimit: 5, callback: (v) => formatRupiahCompact(v) },
        },
        x: {
          border: { color: c.hairline },
          grid: { display: false },
          ticks: { color: c.muted, font: { family: fontUI(), size: 11 },
            autoSkip: true, maxTicksLimit: 12, maxRotation: 0 },
        },
      },
    },
    plugins: [crosshairPlugin],
  });
  chart.$crosshairColor = hexToRgba(c.brand, 0.35);
  charts.set('modal', chart);
  document.getElementById('modal-close').focus();
}

function statTile(label, value) {
  return `<div class="modal-stat"><div class="ms-label">${escapeHtml(label)}</div>` +
    `<div class="ms-value">${escapeHtml(value)}</div></div>`;
}

function closeOutletModal() {
  modal.hidden = true;
  document.body.style.overflow = '';
  destroyChart('modal');
}

// ---------- orchestration ----------
async function loadMonth() {
  setLoading(true);
  const monthLabel = `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;

  try {
    const prev = currentMonth === 1
      ? { year: currentYear - 1, month: 12 }
      : { year: currentYear, month: currentMonth - 1 };

    const [dailyRows, prevRows] = await Promise.all([
      fetchDailyReportsForMonth(currentYear, currentMonth),
      fetchDailyReportsForMonth(prev.year, prev.month),
    ]);

    setLoading(false);
    currentDailyRows = dailyRows;

    const stats = computeHeadlineStats(dailyRows, outlets);
    const mom = computeMoMComparison(dailyRows, prevRows);
    renderStats(stats, mom, monthLabel);

    renderTotalTrend(dailyRows);
    renderDonut(dailyRows);
    renderTrendGrid(dailyRows);

    // Default the daily ranking to the latest date that has data, then render
    // whichever ranking mode is currently selected.
    lastDefaultDate = pickDefaultRankingDate(dailyRows);
    rankingDateInput.value = lastDefaultDate || '';
    applyRankingMode();

    const outletsWithData = new Set(dailyRows.map((r) => r.outlet_id)).size;
    document.getElementById('footnote').textContent =
      `${outletsWithData} dari ${outlets.length} outlet melaporkan data di ${monthLabel}.`;
  } catch (err) {
    setLoading(false);
    showToast(`Gagal memuat data: ${err.message}`);
    document.getElementById('footnote').textContent =
      'Data gagal dimuat. Periksa koneksi lalu muat ulang halaman.';
  }
}

async function init() {
  const session = await requireSession();
  if (!session) return;

  setLoading(true);
  try {
    outlets = await fetchOutlets();
  } catch (err) {
    setLoading(false);
    showToast(`Gagal memuat daftar outlet: ${err.message}`);
    return;
  }

  populateMonthSelect();
  renderFreshness();          // global, not month-scoped — fetch once
  await loadMonth();

  monthSelect.addEventListener('change', async () => {
    const [year, month] = monthSelect.value.split('-').map(Number);
    currentYear = year;
    currentMonth = month;
    await loadMonth();
  });

  // Ranking mode toggle (Harian / Bulanan)
  document.getElementById('seg-harian').addEventListener('click', () => {
    if (rankingMode === 'harian') return;
    rankingMode = 'harian';
    applyRankingMode();
  });
  document.getElementById('seg-bulanan').addEventListener('click', () => {
    if (rankingMode === 'bulanan') return;
    rankingMode = 'bulanan';
    applyRankingMode();
  });

  rankingDateInput.addEventListener('change', () => {
    if (rankingMode === 'harian' && rankingDateInput.value) {
      renderRankingHarian(rankingDateInput.value);
    }
  });

  // Modal close: button, backdrop click, Escape
  document.getElementById('modal-close').addEventListener('click', closeOutletModal);
  modal.addEventListener('click', (e) => {
    if (e.target.dataset.close) closeOutletModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeOutletModal();
  });

  logoutBtn.addEventListener('click', logout);

  // Repaint charts when the OS theme flips so the ink tokens stay in sync.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      destroyAllCharts();
      renderFreshness();
      loadMonth();
    });
  }
}

init();
