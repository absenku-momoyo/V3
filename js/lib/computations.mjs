const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// Render a Supabase timestamptz (UTC) as "31 Juli 2026, 16:50 WIB".
// WIB is a fixed UTC+7 offset (no DST), so we shift the epoch by +7h and read
// the UTC fields — deterministic regardless of the viewer's local timezone.
export function formatUpdatedAtWIB(iso) {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const wib = new Date(t.getTime() + 7 * 3600 * 1000);
  const d = wib.getUTCDate();
  const month = MONTHS_ID[wib.getUTCMonth()];
  const y = wib.getUTCFullYear();
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${d} ${month} ${y}, ${hh}:${mm} WIB`;
}

// Aggregate the tunai/online breakdown across a month's rows for the donut.
// Rows not yet backfilled carry null in both columns and are simply skipped;
// hasSplit is false only when NO row has the breakdown, so the UI can show a
// "belum ada rincian" state instead of an empty 0/0 donut.
export function computeCashOnlineSplit(dailyRows) {
  let tunai = 0;
  let online = 0;
  let hasSplit = false;
  dailyRows.forEach((r) => {
    if (r.omzet_tunai == null && r.omzet_online == null) return;
    hasSplit = true;
    tunai += Number(r.omzet_tunai) || 0;
    online += Number(r.omzet_online) || 0;
  });
  return { tunai, online, total: tunai + online, hasSplit };
}

export function computeMonthlySummary(dailyRows, outlets) {
  const totals = new Map();
  outlets.forEach((o) => totals.set(o.id, 0));
  dailyRows.forEach((row) => {
    totals.set(row.outlet_id, (totals.get(row.outlet_id) || 0) + row.omzet);
  });
  const rows = outlets.map((o) => ({
    outlet_id: o.id,
    outlet_name: o.name,
    total: totals.get(o.id) || 0,
  }));
  rows.sort((a, b) => b.total - a.total);
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);
  return { rows, grandTotal };
}

export function pickDefaultRankingDate(dailyRows) {
  if (dailyRows.length === 0) return null;
  return dailyRows.reduce(
    (latest, row) => (row.report_date > latest ? row.report_date : latest),
    dailyRows[0].report_date
  );
}

// ---------- Rupiah formatting (Indonesian: "." thousands, "," decimal) ----------

// Compact form for headline figures and axis ticks: "Rp 442,3 jt".
// Units: rb (ribu/thousand), jt (juta/million), M (miliar/billion).
export function formatRupiahCompact(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);

  // Precision ladder: miliar keeps 2 decimals (1 would collapse 1,57 M to
  // 1,6 M and lose real signal on the headline figure), juta keeps 1.
  const scale = (divisor, suffix, decimals) => {
    const scaled = abs / divisor;
    const text = scaled
      .toFixed(decimals)
      .replace(/\.?0+$/, '')   // drop trailing zeros AND a bare trailing dot
      .replace('.', ',');
    return `${sign}Rp ${text} ${suffix}`;
  };

  if (abs >= 1e9) return scale(1e9, 'M', 2);
  if (abs >= 1e6) return scale(1e6, 'jt', 1);
  if (abs >= 1e3) return `${sign}Rp ${Math.round(abs / 1e3)} rb`;
  return `${sign}Rp ${Math.round(abs)}`;
}

// Exact form for tooltips and drill-downs: "Rp 442.301.845".
export function formatRupiahFull(value) {
  const n = Math.round(Number(value) || 0);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp ${digits}`;
}

// ---------- Headline stats for the summary cards ----------

// activeDays counts DISTINCT report dates, so the average is per calendar day
// of trading, not per data row (14 outlets on one day is still one day).
export function computeHeadlineStats(dailyRows, outlets) {
  const { rows, grandTotal } = computeMonthlySummary(dailyRows, outlets);
  const activeDays = new Set(dailyRows.map((r) => r.report_date)).size;
  const best = rows.length && rows[0].total > 0 ? rows[0] : null;
  return {
    grandTotal,
    activeDays,
    avgPerDay: activeDays ? grandTotal / activeDays : 0,
    bestOutlet: best,
    rows,
  };
}

// ---------- Month-over-month ----------

const dayOfMonth = (isoDate) => Number(isoDate.slice(8, 10));

// Like-for-like comparison: an in-progress month is only compared against the
// SAME span of the previous month (days 1..throughDay). Comparing a partial
// month against a full one would overstate a decline every time.
// percent is null when there is no baseline to divide by — the UI must then
// show "no comparison" rather than a fabricated 0% or 100%.
export function computeMoMComparison(currentRows, prevRows) {
  const currentTotal = currentRows.reduce((s, r) => s + r.omzet, 0);
  const throughDay = currentRows.reduce((max, r) => Math.max(max, dayOfMonth(r.report_date)), 0);
  const prevTotal = prevRows
    .filter((r) => dayOfMonth(r.report_date) <= throughDay)
    .reduce((s, r) => s + r.omzet, 0);
  const percent = prevTotal > 0 && throughDay > 0
    ? ((currentTotal - prevTotal) / prevTotal) * 100
    : null;
  return { currentTotal, prevTotal, throughDay, percent };
}

export function buildTrendSeries(dailyRows, outlets, year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  const byOutletDate = new Map();
  dailyRows.forEach((row) => {
    byOutletDate.set(`${row.outlet_id}|${row.report_date}`, row.omzet);
  });
  return outlets.map((o) => ({
    outlet_id: o.id,
    outlet_name: o.name,
    points: dates.map((date) => ({
      date,
      omzet: byOutletDate.has(`${o.id}|${date}`) ? byOutletDate.get(`${o.id}|${date}`) : null,
    })),
  }));
}
