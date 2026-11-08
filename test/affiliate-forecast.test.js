'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildForecast } = require('../lib/affiliate-forecast');

test('produces a usable forecast with only pending orders and no signed orders', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const result = buildForecast({
    now,
    orders: [
      { orderNo: 'A', createTime: now - 2 * 86400000, orderStatus: 'Pending', totalCommissionAmount: 1200, orderAmount: 5000 },
      { orderNo: 'B', createTime: now - 86400000, orderStatus: 'Pending', totalCommissionAmount: 800, orderAmount: 3000 }
    ]
  });
  assert.equal(result.statusCounts.Signed, 0);
  assert.equal(result.statusCounts.Pending, 2);
  assert.ok(result.projections.monthEnd.realistic > 0);
  assert.equal(result.totals.signed, 0);
  assert.equal(result.dataQuality.confidence, 'faible');
  assert.match(result.pipeline.assumptionSource, /hypothèses provisoires/);
});

test('does not claim medium confidence when all orders are still pending', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const day = 86400000;
  const orders = Array.from({ length: 30 }, (_, i) => ({
    orderNo: 'P' + i,
    createTime: now - i * day,
    orderStatus: 'Pending',
    totalCommissionAmount: 1000,
    orderAmount: 5000
  }));
  const result = buildForecast({ now, orders });
  assert.equal(result.statusCounts.Signed, 0);
  assert.equal(result.statusCounts.Pending, 30);
  assert.equal(result.dataQuality.confidence, 'faible');
  assert.ok(result.projections.monthEnd.realistic > 0);
});
});

test('does not count the same order as estimated, confirmed and signed revenue', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const result = buildForecast({
    now,
    orders: [
      { orderNo: 'A', createTime: now - 86400000, orderStatus: 'Signed', totalCommissionAmount: 1000, actualCommission: 900, actualSubsidy: 100, signCommissionAmount: 800, signSubsidyAmount: 100 }
    ]
  });
  assert.equal(result.statusCounts.Signed, 1);
  assert.equal(result.pipeline.expectedSigned, 0);
  assert.equal(result.totals.signed, 900);
  assert.equal(result.totals.estimated, 1000);
});

test('ignores canceled orders in revenue while retaining cancellation counts', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const result = buildForecast({
    now,
    orders: [
      { orderNo: 'A', createTime: now - 86400000, orderStatus: 'Canceled', totalCommissionAmount: 1000 },
      { orderNo: 'B', createTime: now - 86400000, orderStatus: 'Pending', totalCommissionAmount: 500 }
    ]
  });
  assert.equal(result.statusCounts.Canceled, 1);
  assert.equal(result.totals.estimated, 500);
  assert.equal(result.totals.canceledPotential, 1000);
});


test('calibrates only after three non-overlapping completed forecast periods', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const day = 86400000;
  const snapshots = [-100, -65, -30].map(offset => ({
    at: new Date(now + offset * day).toISOString(),
    forecast30: 1000
  }));
  const events = [-90, -55, -15].map((offset, index) => ({
    orderNo: 'S' + index,
    fromStatus: 'Pending',
    toStatus: 'Signed',
    at: new Date(now + offset * day).toISOString(),
    signedCommission: 1200
  }));
  const result = buildForecast({ now, snapshots, events, orders: [] });
  assert.equal(result.dataQuality.forecastBacktests, 3);
  assert.equal(result.dataQuality.calibrationFactor, 1.2);
  assert.ok(result.dataQuality.forecastMeanAbsoluteError > 0.16);
});
