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
  formatUpdatedAtWIB,
  computeCashOnlineSplit,
  computePerOutletMoM,
  sameDayPrevMonth,
  computeDayOverSameDayLastMonth,
  formatSignedRupiahCompact,
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

// ---------- Last-updated timestamp (WIB) ----------

test('formatUpdatedAtWIB converts a UTC timestamp to WIB (UTC+7) with Indonesian month', () => {
  // 09:50 UTC -> 16:50 WIB, same day
  assert.equal(formatUpdatedAtWIB('2026-07-31T09:50:15+00:00'), '31 Juli 2026, 16:50 WIB');
});

test('formatUpdatedAtWIB rolls the date forward when +7 crosses midnight', () => {
  // 23:30 UTC on Jul 31 -> 06:30 WIB on Aug 1
  assert.equal(formatUpdatedAtWIB('2026-07-31T23:30:00+00:00'), '1 Agustus 2026, 06:30 WIB');
});

test('formatUpdatedAtWIB matches the 07:30 morning-push example', () => {
  // 00:30 UTC -> 07:30 WIB
  assert.equal(formatUpdatedAtWIB('2026-08-01T00:30:00+00:00'), '1 Agustus 2026, 07:30 WIB');
});

test('formatUpdatedAtWIB returns null on empty or invalid input', () => {
  assert.equal(formatUpdatedAtWIB(null), null);
  assert.equal(formatUpdatedAtWIB(''), null);
  assert.equal(formatUpdatedAtWIB('not-a-date'), null);
});

// ---------- Cash vs Online split (donut) ----------

test('computeCashOnlineSplit sums the tunai/online columns when present', () => {
  const rows = [
    { omzet: 300, omzet_tunai: 100, omzet_online: 200 },
    { omzet: 150, omzet_tunai: 50, omzet_online: 100 },
  ];
  const s = computeCashOnlineSplit(rows);
  assert.equal(s.tunai, 150);
  assert.equal(s.online, 300);
  assert.equal(s.total, 450);
  assert.equal(s.hasSplit, true);
});

test('computeCashOnlineSplit reports hasSplit=false when no row carries a split', () => {
  const rows = [
    { omzet: 300, omzet_tunai: null, omzet_online: null },
    { omzet: 150, omzet_tunai: null, omzet_online: null },
  ];
  const s = computeCashOnlineSplit(rows);
  assert.equal(s.tunai, 0);
  assert.equal(s.online, 0);
  assert.equal(s.total, 0);
  assert.equal(s.hasSplit, false);
});

test('computeCashOnlineSplit ignores null split cells but still sums the populated ones', () => {
  const rows = [
    { omzet: 300, omzet_tunai: 100, omzet_online: 200 },
    { omzet: 150, omzet_tunai: null, omzet_online: null }, // not yet backfilled
  ];
  const s = computeCashOnlineSplit(rows);
  assert.equal(s.tunai, 100);
  assert.equal(s.online, 200);
  assert.equal(s.hasSplit, true);
});

test('computeCashOnlineSplit coerces string numerics (Postgres numeric can serialize as text)', () => {
  const rows = [{ omzet: 300, omzet_tunai: '100.50', omzet_online: '199.50' }];
  const s = computeCashOnlineSplit(rows);
  assert.equal(s.tunai, 100.5);
  assert.equal(s.online, 199.5);
});

// ---------- Per-outlet same-period MoM (ranking column) ----------

test('computePerOutletMoM: per-outlet delta, prev truncated to the global throughDay', () => {
  const current = [
    { outlet_id: 1, report_date: '2026-08-01', omzet: 100 },
    { outlet_id: 1, report_date: '2026-08-02', omzet: 100 },
    { outlet_id: 2, report_date: '2026-08-01', omzet: 50 },
  ]; // throughDay = 2
  const prev = [
    { outlet_id: 1, report_date: '2026-07-01', omzet: 100 },
    { outlet_id: 1, report_date: '2026-07-02', omzet: 100 },
    { outlet_id: 1, report_date: '2026-07-03', omzet: 9999 }, // day 3 > 2 -> excluded
    { outlet_id: 2, report_date: '2026-07-01', omzet: 100 },
  ];
  const m = computePerOutletMoM(current, prev);
  assert.equal(m.get(1).percent, 0);     // 200 vs 200
  assert.equal(m.get(2).percent, -50);   // 50 vs 100
});

test('computePerOutletMoM: null percent when an outlet has no prior baseline', () => {
  const current = [{ outlet_id: 1, report_date: '2026-08-01', omzet: 100 }];
  const m = computePerOutletMoM(current, []);
  assert.equal(m.get(1).percent, null);
});

test('computePerOutletMoM: outlet that reported last month but not this -> -100%', () => {
  const current = [{ outlet_id: 1, report_date: '2026-08-05', omzet: 100 }]; // throughDay 5
  const prev = [
    { outlet_id: 1, report_date: '2026-07-05', omzet: 100 },
    { outlet_id: 2, report_date: '2026-07-05', omzet: 200 }, // none this month
  ];
  const m = computePerOutletMoM(current, prev);
  assert.equal(m.get(1).percent, 0);
  assert.equal(m.get(2).percent, -100);  // 0 vs 200
});

test('computePerOutletMoM: a completed month compares full vs full (throughDay = last day)', () => {
  // Viewing a finished month: latest data day is the 3rd, prev cut to <=3 = its full span.
  const current = [
    { outlet_id: 1, report_date: '2026-06-01', omzet: 100 },
    { outlet_id: 1, report_date: '2026-06-03', omzet: 100 },
  ]; // throughDay 3
  const prev = [
    { outlet_id: 1, report_date: '2026-05-01', omzet: 50 },
    { outlet_id: 1, report_date: '2026-05-03', omzet: 50 },
  ];
  const m = computePerOutletMoM(current, prev);
  assert.equal(m.get(1).percent, 100);   // 200 vs 100
});

// ---------- Day-vs-same-day-last-month (Harian ranking mode) ----------

test('sameDayPrevMonth: basic case within the same year', () => {
  assert.equal(sameDayPrevMonth('2026-07-22'), '2026-06-22');
});

test('sameDayPrevMonth: rolls back across a year boundary (January -> December)', () => {
  assert.equal(sameDayPrevMonth('2026-01-15'), '2025-12-15');
});

test('sameDayPrevMonth: returns null when the day does not exist in the shorter previous month', () => {
  // July 31 -> June has only 30 days -> no valid same-day baseline
  assert.equal(sameDayPrevMonth('2026-07-31'), null);
});

test('sameDayPrevMonth: end-of-February edge (March 1 -> Feb has 28 days in 2026, non-leap)', () => {
  assert.equal(sameDayPrevMonth('2026-03-01'), '2026-02-01');
  assert.equal(sameDayPrevMonth('2026-03-29'), null); // Feb 2026 has no 29th
});

test('computeDayOverSameDayLastMonth: compares the picked date vs the same day last month', () => {
  const current = [
    { outlet_id: 1, report_date: '2026-07-22', omzet: 200 },
    { outlet_id: 1, report_date: '2026-07-21', omzet: 999 }, // must be ignored — wrong date
  ];
  const prev = [
    { outlet_id: 1, report_date: '2026-06-22', omzet: 100 },
    { outlet_id: 1, report_date: '2026-06-21', omzet: 999 }, // must be ignored — wrong date
  ];
  const m = computeDayOverSameDayLastMonth('2026-07-22', current, prev);
  assert.equal(m.get(1).currentValue, 200);
  assert.equal(m.get(1).prevValue, 100);
  assert.equal(m.get(1).percent, 100); // +100%
});

test('KEY REGRESSION: changing the picked date changes the result (was previously frozen)', () => {
  const current = [
    { outlet_id: 1, report_date: '2026-07-10', omzet: 100 },
    { outlet_id: 1, report_date: '2026-07-22', omzet: 400 },
  ];
  const prev = [
    { outlet_id: 1, report_date: '2026-06-10', omzet: 100 },
    { outlet_id: 1, report_date: '2026-06-22', omzet: 100 },
  ];
  const day10 = computeDayOverSameDayLastMonth('2026-07-10', current, prev);
  const day22 = computeDayOverSameDayLastMonth('2026-07-22', current, prev);
  assert.equal(day10.get(1).percent, 0);    // 100 vs 100
  assert.equal(day22.get(1).percent, 300);  // 400 vs 100 = +300%
  assert.notEqual(day10.get(1).percent, day22.get(1).percent);
});

test('computeDayOverSameDayLastMonth: null percent when same-day-last-month has no data', () => {
  const current = [{ outlet_id: 1, report_date: '2026-07-22', omzet: 200 }];
  const prev = []; // outlet had no June 22 data
  const m = computeDayOverSameDayLastMonth('2026-07-22', current, prev);
  assert.equal(m.get(1).percent, null);
});

test('computeDayOverSameDayLastMonth: null percent when the previous month has no such day at all (July 31)', () => {
  const current = [{ outlet_id: 1, report_date: '2026-07-31', omzet: 200 }];
  const prev = [{ outlet_id: 1, report_date: '2026-06-30', omzet: 999 }]; // irrelevant, no June 31 exists
  const m = computeDayOverSameDayLastMonth('2026-07-31', current, prev);
  assert.equal(m.get(1).percent, null);
});

test('computeDayOverSameDayLastMonth: outlet reported last month but not on the picked date -> -100%', () => {
  const current = []; // no outlet 1 row for July 22
  const prev = [{ outlet_id: 1, report_date: '2026-06-22', omzet: 500 }];
  const m = computeDayOverSameDayLastMonth('2026-07-22', current, prev);
  assert.equal(m.get(1).currentValue, 0);
  assert.equal(m.get(1).percent, -100);
});

// ---------- Signed compact rupiah (nominal delta under the % in Peringkat) ----------

test('formatSignedRupiahCompact prefixes a positive delta with "+"', () => {
  assert.equal(formatSignedRupiahCompact(2000000), '+Rp 2 jt');
  assert.equal(formatSignedRupiahCompact(442301845), '+Rp 442,3 jt');
});

test('formatSignedRupiahCompact does NOT double up the sign on a negative delta', () => {
  // formatRupiahCompact already renders its own leading "-" for negatives.
  assert.equal(formatSignedRupiahCompact(-1600000), '-Rp 1,6 jt');
});

test('formatSignedRupiahCompact treats zero as non-negative (gets a "+")', () => {
  assert.equal(formatSignedRupiahCompact(0), '+Rp 0');
});
