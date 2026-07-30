import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMonthlySummary, pickDefaultRankingDate, buildTrendSeries } from '../js/lib/computations.mjs';

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
