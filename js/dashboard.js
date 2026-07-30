// D:\Laporan Online\dashboard-keuangan\js\dashboard.js
import { requireSession, logout } from './auth.js';
import { fetchOutlets, fetchDailyReportsForMonth, fetchRankingForDate } from './data.js';
import { computeMonthlySummary, pickDefaultRankingDate, buildTrendSeries } from './lib/computations.mjs';

const monthSelect = document.getElementById('month-select');
const rankingDateInput = document.getElementById('ranking-date');
const logoutBtn = document.getElementById('logout-btn');

let outlets = [];
let currentYear;
let currentMonth;
const trendCharts = new Map();

function monthOptions() {
  const now = new Date();
  const options = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }),
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

function renderSummary(dailyRows) {
  const { rows, grandTotal } = computeMonthlySummary(dailyRows, outlets);
  document.getElementById('grand-total').textContent = 'Total: Rp ' + grandTotal.toLocaleString('id-ID');
  const tbody = document.querySelector('#summary-table tbody');
  tbody.innerHTML = '';
  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (i + 1) + '</td>' +
      '<td>' + row.outlet_name + '</td>' +
      '<td>Rp ' + row.total.toLocaleString('id-ID') + '</td>';
    tbody.appendChild(tr);
  });
}

async function renderRanking(dateStr) {
  const ranking = await fetchRankingForDate(dateStr);
  const tbody = document.querySelector('#ranking-table tbody');
  tbody.innerHTML = '';
  ranking.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + row.peringkat + '</td>' +
      '<td>' + row.outlet_name + '</td>' +
      '<td>Rp ' + Number(row.omzet).toLocaleString('id-ID') + '</td>';
    tbody.appendChild(tr);
  });
}

function renderTrendGrid(dailyRows) {
  const series = buildTrendSeries(dailyRows, outlets, currentYear, currentMonth);
  const grid = document.getElementById('trend-grid');
  trendCharts.forEach((chart) => chart.destroy());
  trendCharts.clear();
  grid.innerHTML = '';

  series.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'trend-card';
    const title = document.createElement('h3');
    title.textContent = s.outlet_name;
    const canvas = document.createElement('canvas');
    card.appendChild(title);
    card.appendChild(canvas);
    grid.appendChild(card);

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: s.points.map((p) => p.date.slice(8, 10)),
        datasets: [{
          data: s.points.map((p) => p.omzet),
          borderColor: '#2563eb',
          spanGaps: false,
          tension: 0.2,
          pointRadius: 0,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { display: false }, x: { display: false } },
      },
    });
    trendCharts.set(s.outlet_id, chart);
  });
}

async function loadMonth() {
  const dailyRows = await fetchDailyReportsForMonth(currentYear, currentMonth);
  renderSummary(dailyRows);
  renderTrendGrid(dailyRows);

  const defaultDate = pickDefaultRankingDate(dailyRows);
  if (defaultDate) {
    rankingDateInput.value = defaultDate;
    await renderRanking(defaultDate);
  } else {
    rankingDateInput.value = '';
    document.querySelector('#ranking-table tbody').innerHTML = '';
  }
}

async function init() {
  const session = await requireSession();
  if (!session) return;

  outlets = await fetchOutlets();
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
}

init();
