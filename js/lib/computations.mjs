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
