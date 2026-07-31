import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMonthlySummary,
  pickDefaultRankingDate,
  buildTrendSeries,
  formatRupiahCompact,
  formatRupiahFull,
  computeHeadlineStats,
  computeMoMComparison,
} from '../js/lib/computations.mjs';

test('computeMonthlySummary sums per outlet and sorts descending', () => {
  const outlets = [
    { id: 1, name: 'A' },
    { id: 2, name: 'B' },
  ];
  const dailyRows = [
    { outlet_id: 1, report_date: '2026-07-01', omzet: 100 },
    { outlet_id: 1, report_date: '2026-07-02', omzet: 50 },
    { outlet_id: 2, report_date: '2026-07-01', omzet: 300 },
  ];
  const { rows, grandTotal } = computeMonthlySummary(dailyRows, outlets);
  assert.equal(grandTotal, 450);
  assert.deepEqual(rows[0], { outlet_id: 2, outlet_name: 'B', total: 300 });
  assert.deepEqual(rows[1], { outlet_id: 1, outlet_name: 'A', total: 150 });
});

test('computeMonthlySummary includes outlets with zero data', () => {
  const outlets = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
  const { rows, grandTotal } = computeMonthlySummary([], outlets);
  assert.equal(grandTotal, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].total, 0);
});

test('pickDefaultRankingDate returns the latest date present', () => {
  const dailyRows = [
    { outlet_id: 1, report_date: '2026-07-05', omzet: 10 },
    { outlet_id: 2, report_date: '2026-07-29', omzet: 20 },
    { outlet_id: 1, report_date: '2026-07-15', omzet: 30 },
  ];
  assert.equal(pickDefaultRankingDate(dailyRows), '2026-07-29');
});

test('pickDefaultRankingDate returns null when no data', () => {
  assert.equal(pickDefaultRankingDate([]), null);
});

test('buildTrendSeries fills every day of month, null when missing', () => {
  const outlets = [{ id: 1, name: 'A' }];
  const dailyRows = [{ outlet_id: 1, report_date: '2026-02-01', omzet: 500 }];
  const series = buildTrendSeries(dailyRows, outlets, 2026, 2);
  assert.equal(series.length, 1);
  assert.equal(series[0].points.length, 28);
  assert.equal(series[0].points[0].omzet, 500);
  assert.equal(series[0].points[1].omzet, null);
});

// ---------- Rupiah formatting ----------

test('formatRupiahCompact abbreviates to rb / jt / M with Indonesian comma decimals', () => {
  assert.equal(formatRupiahCompact(442301845), 'Rp 442,3 jt');
  assert.equal(formatRupiahCompact(1405632), 'Rp 1,4 jt');
  assert.equal(formatRupiahCompact(94000), 'Rp 94 rb');
  assert.equal(formatRupiahCompact(1234567890), 'Rp 1,23 M');
});

test('formatRupiahCompact keeps 2 decimals at miliar scale so the headline keeps signal', () => {
  // 1 decimal would collapse this to "Rp 1,6 M" and hide ~7 juta of movement.
  assert.equal(formatRupiahCompact(1567310181), 'Rp 1,57 M');
});

test('formatRupiahCompact drops trailing zeros so round numbers stay clean', () => {
  assert.equal(formatRupiahCompact(2000000), 'Rp 2 jt');
  assert.equal(formatRupiahCompact(3000000000), 'Rp 3 M');
  assert.equal(formatRupiahCompact(1500000000), 'Rp 1,5 M'); // not "1,50 M"
});

test('formatRupiahCompact handles zero, small values, and negatives', () => {
  assert.equal(formatRupiahCompact(0), 'Rp 0');
  assert.equal(formatRupiahCompact(750), 'Rp 750');
  assert.equal(formatRupiahCompact(-1500000), '-Rp 1,5 jt');
});

test('formatRupiahFull uses dot thousand separators for exact values', () => {
  assert.equal(formatRupiahFull(442301845), 'Rp 442.301.845');
  assert.equal(formatRupiahFull(0), 'Rp 0');
});

// ---------- Headline stats ----------

test('computeHeadlineStats returns total, per-day average, and the best outlet', () => {
  const outlets = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
  const dailyRows = [
    { outlet_id: 1, report_date: '2026-07-01', omzet: 100 },
    { outlet_id: 2, report_date: '2026-07-01', omzet: 500 },
    { outlet_id: 1, report_date: '2026-07-02', omzet: 200 },
  ];
  const stats = computeHeadlineStats(dailyRows, outlets);
  assert.equal(stats.grandTotal, 800);
  assert.equal(stats.activeDays, 2);       // 2 distinct dates, not 3 rows
  assert.equal(stats.avgPerDay, 400);      // 800 / 2 days
  assert.equal(stats.bestOutlet.outlet_name, 'B'); // 500 > A's 300
  assert.equal(stats.bestOutlet.total, 500);
});

test('computeHeadlineStats is safe on empty data (no divide-by-zero)', () => {
  const stats = computeHeadlineStats([], [{ id: 1, name: 'A' }]);
  assert.equal(stats.grandTotal, 0);
  assert.equal(stats.activeDays, 0);
  assert.equal(stats.avgPerDay, 0);
  assert.equal(stats.bestOutlet, null);
});

// ---------- Month-over-month ----------

test('computeMoMComparison compares like-for-like: prev month is cut to the same day', () => {
  // Current month has data only through the 2nd; comparing against the FULL
  // previous month would be misleading, so prev is truncated to day <= 2.
  const current = [
    { report_date: '2026-07-01', omzet: 100 },
    { report_date: '2026-07-02', omzet: 100 },
  ];
  const prev = [
    { report_date: '2026-06-01', omzet: 50 },
    { report_date: '2026-06-02', omzet: 50 },
    { report_date: '2026-06-03', omzet: 9999 }, // must be excluded
  ];
  const mom = computeMoMComparison(current, prev);
  assert.equal(mom.currentTotal, 200);
  assert.equal(mom.prevTotal, 100);          // 9999 excluded
  assert.equal(mom.throughDay, 2);
  assert.equal(mom.percent, 100);            // +100%
});

test('computeMoMComparison returns null percent when there is no prior baseline', () => {
  const mom = computeMoMComparison([{ report_date: '2026-07-01', omzet: 100 }], []);
  assert.equal(mom.prevTotal, 0);
  assert.equal(mom.percent, null);           // cannot divide by zero -> no claim
});

test('computeMoMComparison returns null percent when current month is empty', () => {
  const mom = computeMoMComparison([], [{ report_date: '2026-06-01', omzet: 50 }]);
  assert.equal(mom.currentTotal, 0);
  assert.equal(mom.throughDay, 0);
  assert.equal(mom.percent, null);
});
