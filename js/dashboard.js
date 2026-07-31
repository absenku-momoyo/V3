// Dashboard rendering: headline stats, aggregate trend, ranked tables,
// and per-outlet small multiples.
import { requireSession, logout } from './auth.js';
import { fetchOutlets, fetchDailyReportsForMonth, fetchRankingForDate } from './data.js';
import {
  computeMonthlySummary,
  pickDefaultRankingDate,
  buildTrendSeries,
  computeHeadlineStats,
  computeMoMComparison,
  formatRupiahCompact,
  formatRupiahFull,
} from './lib/computations.mjs';

const monthSelect = document.getElementById('month-select');
const rankingDateInput = document.getElementById('ranking-date');
const logoutBtn = document.getElementById('logout-btn');
const mainEl = document.getElementById('main');
const toastEl = document.getElementById('toast');

let outlets = [];
let currentYear;
let currentMonth;
const charts = new Map();

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

  skeletonRows('#summary-table tbody', 6, 4);
  skeletonRows('#ranking-table tbody', 5, 4);

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
          Math.min(i * 40, 400)}ms"></div></div>` +
        `<span class="share-pct">${pctOfTotal.toFixed(1).replace('.', ',')}%</span>` +
      `</div></td>`;
    tbody.appendChild(tr);
  });
}

function renderSummary(dailyRows) {
  const { rows, grandTotal } = computeMonthlySummary(dailyRows, outlets);
  const tbody = document.querySelector('#summary-table tbody');
  if (!rows.length || grandTotal === 0) {
    emptyRow(tbody, 4, 'Belum ada data omzet untuk periode ini.');
    return;
  }
  const max = rows[0].total;
  buildRankedRows(tbody, rows.map((r) => ({
    name: r.outlet_name,
    value: r.total,
  })), max, grandTotal);
}

async function renderRanking(dateStr) {
  const tbody = document.querySelector('#ranking-table tbody');
  const note = document.getElementById('ranking-note');
  try {
    const ranking = await fetchRankingForDate(dateStr);
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
    .filter((k) => k !== 'total')
    .forEach(destroyChart);
  grid.innerHTML = '';

  // Order the small multiples by monthly total so the grid reads top-down,
  // matching the ranking table rather than an arbitrary alphabetical order.
  const withTotals = series.map((s) => ({
    ...s,
    total: s.points.reduce((sum, p) => sum + (p.omzet || 0), 0),
    daysWithData: s.points.filter((p) => p.omzet !== null).length,
  })).sort((a, b) => b.total - a.total);

  withTotals.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'trend-card' + (s.daysWithData === 0 ? ' trend-card--empty' : '');

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

    const stats = computeHeadlineStats(dailyRows, outlets);
    const mom = computeMoMComparison(dailyRows, prevRows);
    renderStats(stats, mom, monthLabel);

    renderTotalTrend(dailyRows);
    renderSummary(dailyRows);
    renderTrendGrid(dailyRows);

    const defaultDate = pickDefaultRankingDate(dailyRows);
    if (defaultDate) {
      rankingDateInput.value = defaultDate;
      await renderRanking(defaultDate);
    } else {
      rankingDateInput.value = '';
      document.getElementById('ranking-note').textContent =
        'Belum ada data pada periode ini';
      emptyRow(document.querySelector('#ranking-table tbody'), 4,
        'Belum ada data omzet untuk periode ini.');
    }

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
  await loadMonth();

  monthSelect.addEventListener('change', async () => {
    const [year, month] = monthSelect.value.split('-').map(Number);
    currentYear = year;
    currentMonth = month;
    await loadMonth();
  });

  rankingDateInput.addEventListener('change', () => {
    if (rankingDateInput.value) renderRanking(rankingDateInput.value);
  });

  logoutBtn.addEventListener('click', logout);

  // Repaint charts when the OS theme flips so the ink tokens stay in sync.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      destroyAllCharts();
      loadMonth();
    });
  }
}

init();
