'use strict';

const DAY = 86400000;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const firstNumber = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};
const dateMs = value => {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) {
    const n = Number(value);
    if (!(n > 0)) return null;
    return n < 1e12 ? n * 1000 : n;
  }
  const n = Date.parse(value || '');
  return Number.isFinite(n) && n > 0 ? n : null;
};
const orderDate = order => dateMs(order?.createTime || order?.orderTime || order?.timestamp || order?.firstSeenAt);
const statusOf = order => String(order?.orderStatus ?? order?.status ?? 'Unknown').trim().toLowerCase().replace(/[\s_-]+/g, '');
const isCanceled = order => /cancel|annul|refund|return/.test(statusOf(order));
const isSigned = order => /^(signed|sign|complete|completed|finished|settled|validated|valide|validé)$/.test(statusOf(order));
const isDelivered = order => /^(delivered|received|arrived|livre|livré)$/.test(statusOf(order));
const estimateCents = order => Math.max(0, Number(order?.totalCommissionAmount) > 0 ? Number(order.totalCommissionAmount) : firstNumber(order?.commissionAmount) + firstNumber(order?.subsidyAmount));
const confirmedCents = order => Math.max(0,
  firstNumber(order?.actualCommission, order?.actual_commission, order?.actualCommissionAmount) +
  firstNumber(order?.actualSubsidy, order?.actual_subsidy, order?.actualSubsidyAmount));
const signedCents = order => {
  const total = Number(order?.signTotalCommissionAmount || 0);
  return Math.max(0, total > 0 ? total : firstNumber(order?.signCommissionAmount) + firstNumber(order?.signSubsidyAmount));
};
const dayKey = ms => new Date(ms).toISOString().slice(0, 10);
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const pctChange = (current, previous) => previous > 0 ? (current - previous) / previous : null;
const sum = (items, fn) => items.reduce((total, item) => total + fn(item), 0);

function buildForecast({ orders = [], events = [], snapshots = [], now = Date.now(), goals = {} } = {}) {
  const rows = Array.isArray(orders) ? orders.filter(x => x && typeof x === 'object') : [];
  const valid = rows.filter(o => !isCanceled(o));
  const dated = rows.map(o => ({ order: o, ms: orderDate(o) })).filter(x => x.ms != null);
  const firstDate = dated.length ? Math.min(...dated.map(x => x.ms)) : null;
  const lastDate = dated.length ? Math.max(...dated.map(x => x.ms)) : null;
  const start = firstDate == null ? now : firstDate;
  const activityDays = Math.max(1, Math.min(3650, Math.floor((now - start) / DAY) + 1));
  const daily = new Map();
  for (let i = 0; i < activityDays; i++) daily.set(dayKey(start + i * DAY), { commission: 0, orders: 0, sales: 0, canceled: 0 });
  for (const { order, ms } of dated) {
    const key = dayKey(ms);
    if (!daily.has(key)) daily.set(key, { commission: 0, orders: 0, sales: 0, canceled: 0 });
    const bucket = daily.get(key);
    bucket.orders++;
    if (isCanceled(order)) bucket.canceled++;
    else {
      bucket.commission += estimateCents(order);
      bucket.sales += Math.max(0, finite(order.orderAmount));
    }
  }
  const days = [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, ...value }));
  const todayKey = dayKey(now);
  const windowStats = (n, offset = 0) => {
    const subset = days.filter(x => x.date >= dayKey(now - (n + offset - 1) * DAY) && x.date <= dayKey(now - offset * DAY));
    const total = sum(subset, x => x.commission);
    const ordersCount = sum(subset, x => x.orders);
    return { days: subset.length, total, orders: ordersCount, perDay: subset.length ? total / subset.length : 0, ordersPerDay: subset.length ? ordersCount / subset.length : 0 };
  };
  const windows = Object.fromEntries([7, 14, 30, 60, 90].map(n => [n, windowStats(n)]));
  const lifetimeCommission = sum(days, x => x.commission);
  const lifetimeOrders = sum(days, x => x.orders);
  const lifetimePerDay = lifetimeCommission / Math.max(1, activityDays);
  const availableRecent = windows[7].days >= 3 ? windows[7].perDay :
    windows[14].days >= 3 ? windows[14].perDay :
    windows[30].days >= 3 ? windows[30].perDay : lifetimePerDay;
  const growth7 = windows[7].days >= 5 ? pctChange(windows[7].perDay, windowStats(7, 7).perDay) : null;
  const growth30 = windows[30].days >= 14 ? pctChange(windows[30].perDay, windowStats(30, 30).perDay) : null;
  const growth90 = windows[90].days >= 45 ? pctChange(windows[90].perDay, windowStats(90, 90).perDay) : null;
  const recentVsPrevious = windows[7].days >= 7 ? pctChange(windows[7].perDay, windowStats(7, 7).perDay) : null;
  const recentVs30 = windows[30].days >= 14 ? pctChange(windows[7].perDay, windows[30].perDay) : null;
  const trendRaw = recentVs30 ?? recentVsPrevious ?? 0;
  const trend = clamp(trendRaw, -0.35, 0.5);
  const dailyRunRate = Math.max(0, availableRecent * 0.65 + lifetimePerDay * 0.35);

  const statusCounts = { Pending: 0, Delivered: 0, Signed: 0, Canceled: 0, Other: 0 };
  let estimatedOpen = 0, confirmedOpen = 0, signedTotal = 0, canceledEstimate = 0;
  const ageDays = [];
  const byCurrency = {};
  const weekday = Array.from({ length: 7 }, () => ({ orders: 0, commission: 0, days: 0 }));
  const categories = new Map(), products = new Map(), promo = new Map();
  const region = new Map();
  let missingDate = 0, missingCommission = 0, missingSales = 0;
  for (const order of rows) {
    const status = isCanceled(order) ? 'Canceled' : isSigned(order) ? 'Signed' : isDelivered(order) ? 'Delivered' : statusOf(order) === 'pending' ? 'Pending' : 'Other';
    statusCounts[status]++;
    const est = estimateCents(order), actual = confirmedCents(order), signed = signedCents(order);
    if (isCanceled(order)) canceledEstimate += est;
    else if (status === 'Pending') estimatedOpen += est;
    else if (status === 'Delivered') confirmedOpen += actual;
    if (status === 'Signed') signedTotal += signed;
    if (!est && !actual && !signed) missingCommission++;
    if (!(finite(order.orderAmount) > 0)) missingSales++;
    const ms = orderDate(order);
    if (ms == null) missingDate++;
    else {
      const age = Math.max(0, (now - (dateMs(order.firstSeenAt) || ms)) / DAY);
      if (status === 'Pending' || status === 'Delivered') ageDays.push(age);
      const wd = new Date(ms).getUTCDay();
      weekday[wd].orders++;
      weekday[wd].commission += isCanceled(order) ? 0 : est;
    }
    const currency = String(order.currency || 'USD').toUpperCase();
    byCurrency[currency] = (byCurrency[currency] || 0) + 1;
    const category = String(order.productCategory || order.category || '').trim();
    const product = String(order.productName || order.productTitle || order.product || '').trim();
    const campaign = String(order.promoCode || order.couponCode || order.campaignId || '').trim();
    const area = String(order.region || '').trim();
    if (category) categories.set(category, (categories.get(category) || 0) + est);
    if (product) products.set(product, (products.get(product) || 0) + est);
    if (campaign) promo.set(campaign, (promo.get(campaign) || 0) + est);
    if (area) region.set(area, (region.get(area) || 0) + est);
  }
  const totalKnown = rows.length;
  const completed = statusCounts.Signed + statusCounts.Canceled;
  const deliveredObserved = statusCounts.Delivered + statusCounts.Signed;
  // Ignore legacy events: they could have inferred delivery/signature from amount fields.
  const eventTransitions = Array.isArray(events) ? events.filter(e => e && e.statusEvidence === 'orderStatus') : [];
  const eventByOrder = new Map();
  for (const event of eventTransitions) {
    const id = String(event.orderNo || event.code || '');
    if (!id) continue;
    const list = eventByOrder.get(id) || [];
    list.push(event);
    eventByOrder.set(id, list);
  }
  const deliveryDelays = [], signatureDelays = [];
  for (const order of rows) {
    const id = String(order.orderNo || order.code || '');
    const history = (eventByOrder.get(id) || []).slice().sort((x, y) => (dateMs(x.at) || 0) - (dateMs(y.at) || 0));
    const created = orderDate(order);
    const deliveredEvent = history.find(x => x.toStatus === 'Delivered' || x.toStatus === 'Signed');
    const signedEvent = history.find(x => x.toStatus === 'Signed');
    const deliveredAt = (deliveredEvent ? dateMs(deliveredEvent.at) : null) || dateMs(order.deliveredAt);
    const signedAt = (signedEvent ? dateMs(signedEvent.at) : null) || dateMs(order.signedAt);
    if (created && deliveredAt && deliveredAt >= created) deliveryDelays.push((deliveredAt - created) / DAY);
    if (deliveredAt && signedAt && signedAt >= deliveredAt) signatureDelays.push((signedAt - deliveredAt) / DAY);
  }
  const observedSignedTransitions = eventTransitions.filter(e => e.toStatus === 'Signed').length;
  const observedDeliveredTransitions = eventTransitions.filter(e => e.toStatus === 'Delivered' || e.toStatus === 'Signed').length;
  const hasOutcomeEvidence = completed >= 5 || observedSignedTransitions >= 5;
  const cancellationRate = completed >= 5 ? statusCounts.Canceled / completed : null;
  const deliveryRate = (statusCounts.Delivered + statusCounts.Signed + statusCounts.Canceled) >= 5
    ? deliveredObserved / (deliveredObserved + statusCounts.Canceled) : null;
  const signatureRateAfterDelivery = (statusCounts.Delivered + statusCounts.Signed) >= 5
    ? statusCounts.Signed / (statusCounts.Delivered + statusCounts.Signed) : null;
  // Conservative, explicitly provisional priors until the user's own cohort has outcomes.
  const assumptions = {
    deliveryProbability: deliveryRate == null ? 0.72 : clamp(deliveryRate, 0.25, 0.98),
    signatureAfterDeliveryProbability: signatureRateAfterDelivery == null ? 0.72 : clamp(signatureRateAfterDelivery, 0.2, 0.98),
    cancellationProbability: cancellationRate == null ? 0.12 : clamp(cancellationRate, 0.01, 0.65),
    source: hasOutcomeEvidence ? 'historique personnel' : 'hypothèses provisoires prudentes'
  };
  const pendingProbability = clamp(assumptions.deliveryProbability * assumptions.signatureAfterDeliveryProbability * (1 - assumptions.cancellationProbability), 0.03, 0.95);
  const deliveredProbability = clamp(assumptions.signatureAfterDeliveryProbability * (1 - assumptions.cancellationProbability * 0.35), 0.05, 0.98);
  let pipelineExpected = 0;
  for (const order of rows) {
    if (isCanceled(order) || isSigned(order)) continue;
    const est = isDelivered(order) ? (confirmedCents(order) || estimateCents(order)) : estimateCents(order);
    if (!est) continue;
    pipelineExpected += est * (isDelivered(order) ? deliveredProbability : pendingProbability);
  }

  const eventDates = eventTransitions.map(e => dateMs(e.at)).filter(Boolean);
  const oldestEvent = eventDates.length ? Math.min(...eventDates) : null;
  const historyDays = oldestEvent == null ? 0 : Math.max(1, Math.floor((now - oldestEvent) / DAY) + 1);
  const snapshotRows = Array.isArray(snapshots) ? snapshots : [];
  const maturedSnapshots = snapshotRows.filter(x => x && x.at && Number(x.forecast30) > 0 && dateMs(x.at) != null && dateMs(x.at) + 30 * DAY <= now).sort((a, b) => dateMs(a.at) - dateMs(b.at));
  const backtests = [];
  let lastEvaluatedUntil = 0;
  for (const snapshot of maturedSnapshots) {
    const from = dateMs(snapshot.at), to = from + 30 * DAY;
    if (from < lastEvaluatedUntil) continue;
    const actual = sum(eventTransitions.filter(e => e.toStatus === 'Signed' && dateMs(e.at) > from && dateMs(e.at) <= to), e => finite(e.signedCommission));
    const predicted = Number(snapshot.forecast30);
    backtests.push({ predicted, actual, errorRatio: Math.abs(predicted - actual) / Math.max(predicted, actual, 100) });
    lastEvaluatedUntil = to;
  }
  const calibrationFactor = backtests.length >= 3
    ? clamp(mean(backtests.map(x => x.actual / x.predicted)), 0.7, 1.3)
    : 1;
  for (const day of days) weekday[new Date(day.date + 'T00:00:00Z').getUTCDay()].days++;
  const weekdayData = weekday.map((v, i) => ({ day: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][i], ...v }));
  const weekdayFactorReady = activityDays >= 56 && lifetimePerDay > 0 && weekdayData.every(x => x.days >= 4);
  const weekdayDailyMeans = weekdayData.map(x => x.days ? x.commission / x.days : 0);
  const weekdayMean = mean(weekdayDailyMeans);
  const weekdayFactors = weekdayFactorReady && weekdayMean > 0
    ? weekdayDailyMeans.map(value => clamp(value / weekdayMean, 0.65, 1.35))
    : Array(7).fill(1);
  const weekdayFactorMean = mean(weekdayFactors);
  const normalizedWeekdayFactors = weekdayFactors.map(value => value / (weekdayFactorMean || 1));
  const currentMonthEnd = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1)).getTime();
  const daysToMonthEnd = Math.max(1, Math.ceil((currentMonthEnd - now) / DAY));
  const monthStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
  let monthToDateGenerated = 0, monthToDateExpected = 0, monthToDateSigned = 0, monthToDatePipelineExpected = 0;
  for (const order of rows) {
    const created = orderDate(order);
    if (created == null || created < monthStart || created > now || isCanceled(order)) continue;
    const basis = confirmedCents(order) || estimateCents(order);
    monthToDateGenerated += basis;
    if (isSigned(order)) {
      const finalAmount = signedCents(order);
      monthToDateSigned += finalAmount;
      monthToDateExpected += finalAmount;
    } else if (isDelivered(order)) {
      monthToDatePipelineExpected += basis * deliveredProbability;
      monthToDateExpected += basis * deliveredProbability;
    } else {
      monthToDatePipelineExpected += basis * pendingProbability;
      monthToDateExpected += basis * pendingProbability;
    }
  }
  const makeProjection = (horizon, includeMonthToDate = false) => {
    const growth = clamp(trend, -0.25, 0.35);
    const ramp = horizon <= 30 ? 0.55 : horizon <= 90 ? 0.7 : 0.82;
    const daily = dailyRunRate * (1 + growth * ramp);
    let futureNew = 0;
    for (let day = 1; day <= horizon; day++) {
      const weekdayIndex = new Date(now + day * DAY).getUTCDay();
      futureNew += daily * normalizedWeekdayFactors[weekdayIndex];
    }
    const pipeline = pipelineExpected;
    const pipelineNotAlreadyIncluded = includeMonthToDate ? Math.max(0, pipeline - monthToDatePipelineExpected) : pipeline;
    const futureExpected = Math.max(0, (futureNew * pendingProbability + pipelineNotAlreadyIncluded) * calibrationFactor);
    const accruedExpected = includeMonthToDate ? monthToDateExpected : 0;
    const base = accruedExpected + futureExpected;
    const signedAlready = signedTotal;
    const pessimistic = accruedExpected + futureExpected * 0.72;
    const optimistic = Math.max(base, accruedExpected + futureExpected * 1.28);
    return {
      days: horizon,
      dailyGenerated: horizon ? futureNew / horizon : daily,
      newOrdersExpectedCommission: futureNew,
      currentPipelineExpected: pipeline,
      monthToDateGenerated: includeMonthToDate ? monthToDateGenerated : 0,
      monthToDateExpected: accruedExpected,
      monthToDateSigned: includeMonthToDate ? monthToDateSigned : 0,
      signedAlready,
      realistic: base,
      pessimistic,
      optimistic
    };
  };
  const projections = {
    oneDay: makeProjection(1),
    sevenDays: makeProjection(7),
    thirtyDays: makeProjection(30),
    monthEnd: makeProjection(daysToMonthEnd, true),
    threeMonths: makeProjection(90),
    sixMonths: makeProjection(180),
    twelveMonths: makeProjection(365)
  };
  const averageValues = days.map(x => x.commission);
  const bestDay = averageValues.length ? Math.max(...averageValues) : 0;
  const worstDay = averageValues.length ? Math.min(...averageValues) : 0;
  const zeroDays = days.filter(x => x.orders === 0).length;
  const activeRevenueDays = days.filter(x => x.commission > 0).length;
  const orderAmounts = rows.map(o => finite(o.orderAmount)).filter(x => x > 0);
  const commissionAmounts = valid.map(estimateCents).filter(x => x > 0);
  const avgOrderAmount = mean(orderAmounts);
  const avgCommissionPerOrder = mean(commissionAmounts);
  const avgCommissionRate = sum(valid, o => estimateCents(o)) / Math.max(1, sum(valid, o => finite(o.orderAmount))) * 100;
  const salesTotal = sum(valid, o => finite(o.orderAmount));
  const signedAmount = signedTotal;
  const estimatedTotal = sum(valid, estimateCents);
  const confirmedTotal = sum(valid, confirmedCents);
  const refundCount = rows.filter(o => /refund|return/.test(statusOf(o))).length;
  const deliveredCommissions = rows.filter(o => isDelivered(o) && !isSigned(o) && !isCanceled(o)).map(estimateCents).filter(x => x > 0);
  const signedCommissions = rows.filter(isSigned).map(o => signedCents(o) || confirmedCents(o) || estimateCents(o)).filter(x => x > 0);
  const orderMedian = median(orderAmounts);
  const commissionMedian = median(commissionAmounts);
  const outliers = commissionAmounts.filter(x => commissionMedian > 0 && x > commissionMedian * 3).length;
  const dataQuality = {
    historyDays: activityDays,
    transitionHistoryDays: historyDays,
    orders: totalKnown,
    datedOrders: dated.length,
    missingDate,
    missingCommission,
    missingSales,
    statusKnown: rows.filter(o => statusOf(o) && statusOf(o) !== 'unknown').length,
    lastSyncAt: null,
    snapshots: snapshotRows.length,
    confidence: totalKnown >= 100 && activityDays >= 90 && (completed >= 15 || observedSignedTransitions >= 15) ? 'élevé' :
      totalKnown >= 25 && activityDays >= 30 && (completed >= 5 || observedSignedTransitions >= 5) ? 'moyen' : 'faible',
    forecastBacktests: backtests.length,
    forecastMeanAbsoluteError: backtests.length ? mean(backtests.map(x => x.errorRatio)) : null,
    calibrationFactor
  };
  const missingInputs = [];
  if (historyDays < 30) missingInputs.push('Historique des transitions de statut encore court');
  if (backtests.length < 3) missingInputs.push('Pas encore assez de prévisions passées pour mesurer et corriger l’erreur du modèle');
  if (!rows.some(o => o.productName || o.productTitle || o.productCategory || o.category)) missingInputs.push('Produits et catégories non fournis par le rapport Hacoo');
  if (!rows.some(o => o.promoCode || o.couponCode || o.campaignId)) missingInputs.push('Codes promotionnels et campagnes non fournis');
  if (!rows.some(o => o.clicks != null || o.clickCount != null || o.affiliateClicks != null)) missingInputs.push('Clics affiliés et conversions par clic indisponibles');
  if (!rows.some(o => o.telegramViews != null || o.postViews != null)) missingInputs.push('Vues Telegram et attribution par publication indisponibles');
  if (!rows.some(o => o.refundAmount != null || o.refundedAt != null || /refund|return/.test(statusOf(o)))) missingInputs.push('Remboursements après livraison/signature non détaillés');
  if (activityDays < 56) missingInputs.push('Saisonnalité hebdomadaire non consolidée');
  if (activityDays < 365) missingInputs.push('Comparaison annuelle et saisonnalité annuelle indisponibles');
  if (!rows.some(o => o.commissionRate != null && Number(o.commissionRate) > 0)) missingInputs.push('Taux de commission par produit non renseigné');
  if (!Object.values(goals || {}).some(value => Number(value) > 0)) missingInputs.push('Objectifs financiers non configurés');
  const growthSimulations = [0.05, 0.1, 0.2, 0.3].map(rate => ({
    growth: rate,
    daily: dailyRunRate * (1 + rate),
    monthly: dailyRunRate * 30 * (1 + rate) * pendingProbability
  }));
  const top = map => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, amount]) => ({ name, amount }));
  return {
    generatedAt: new Date(now).toISOString(),
    currency: 'USD',
    statusCounts,
    averages: {
      daily7: windows[7].perDay, daily14: windows[14].perDay, daily30: windows[30].perDay,
      daily60: windows[60].perDay, daily90: windows[90].perDay, dailySinceStart: lifetimePerDay,
      medianDaily: median(averageValues), bestDay, worstDay, zeroDays, activeRevenueDays,
      trend: trendRaw, trendLabel: trendRaw > 0.05 ? 'hausse' : trendRaw < -0.05 ? 'baisse' : 'stable',
      dailyRunRate, averageOrdersPerDay: lifetimeOrders / Math.max(1, activityDays),
      averageOrderAmount: avgOrderAmount, medianOrderAmount: orderMedian, averageCommissionPerOrder: avgCommissionPerOrder,
      effectiveCommissionRate: avgCommissionRate, commissionPerDelivered: mean(deliveredCommissions), commissionPerSigned: mean(signedCommissions)
    },
    totals: { estimated: estimatedTotal, confirmed: confirmedTotal, signed: signedAmount, canceledPotential: canceledEstimate, sales: salesTotal },
    rates: {
      cancellation: rows.length ? statusCounts.Canceled / rows.length : null,
      delivery: deliveryRate,
      signatureAfterDelivery: signatureRateAfterDelivery,
      signedOverall: rows.length ? statusCounts.Signed / rows.length : null,
      pending: rows.length ? statusCounts.Pending / rows.length : null,
      refund: rows.length ? refundCount / rows.length : null,
      commissionPerDelivered: mean(deliveredCommissions),
      commissionPerSigned: mean(signedCommissions)
    },
    delays: {
      deliveryAverageDays: mean(deliveryDelays),
      deliveryMedianDays: median(deliveryDelays),
      signatureAverageDays: mean(signatureDelays),
      signatureMedianDays: median(signatureDelays),
      deliverySamples: deliveryDelays.length,
      signatureSamples: signatureDelays.length,
      deliveredWithin3Days: deliveryDelays.length ? deliveryDelays.filter(x => x <= 3).length / deliveryDelays.length : null,
      deliveredWithin7Days: deliveryDelays.length ? deliveryDelays.filter(x => x <= 7).length / deliveryDelays.length : null,
      deliveredWithin14Days: deliveryDelays.length ? deliveryDelays.filter(x => x <= 14).length / deliveryDelays.length : null,
      signedWithin7Days: signatureDelays.length ? signatureDelays.filter(x => x <= 7).length / signatureDelays.length : null,
      signedWithin14Days: signatureDelays.length ? signatureDelays.filter(x => x <= 14).length / signatureDelays.length : null,
      signedWithin30Days: signatureDelays.length ? signatureDelays.filter(x => x <= 30).length / signatureDelays.length : null
    },
    growth: { sevenDays: growth7, thirtyDays: growth30, ninetyDays: growth90 },
    orderDistribution: { averageOrderAmount: avgOrderAmount, medianOrderAmount: orderMedian, medianCommission: commissionMedian, outlierCommissions: outliers, refunds: refundCount },
    monthToDate: { generated: monthToDateGenerated, expectedFinal: monthToDateExpected, signed: monthToDateSigned },
    pipeline: {
      pendingEstimated: estimatedOpen, deliveredConfirmed: confirmedOpen,
      expectedSigned: pipelineExpected, pendingOrders: statusCounts.Pending,
      deliveredOrders: statusCounts.Delivered, signedOrders: statusCounts.Signed,
      canceledOrders: statusCounts.Canceled, averageAgeDays: mean(ageDays),
      deliveryProbability: assumptions.deliveryProbability,
      signatureProbability: assumptions.signatureAfterDeliveryProbability,
      cancellationProbability: assumptions.cancellationProbability,
      finalizationProbabilityPending: pendingProbability,
      assumptionSource: assumptions.source
    },
    projections,
    windows,
    weekday: weekdayData,
    weekdayFactorReady,
    breakdowns: { currencies: byCurrency, categories: top(categories), products: top(products), promotions: top(promo), regions: top(region) },
    dataQuality,
    transitionCount: eventTransitions.length,
    missingInputs,
    growthSimulations,
    calendar: { seasonalAdjustmentApplied: false, reason: activityDays < 365 ? 'Historique insuffisant pour mesurer une saisonnalité annuelle fiable.' : 'Aucune série saisonnière annuelle complète exploitable.' },
    methodology: {
      baseline: 'Moyenne journalière pondérée entre la période récente et le début de l’activité.',
      stages: 'Actual Commission et Actual Subsidy ne prouvent ni livraison, ni signature, ni paiement. Le statut Hacoo détermine l’étape ; Signed seul indique une commission définitivement validée. Les montants estimés, réels et signés ne sont jamais additionnés.',
      pipeline: 'Les commandes Pending et Delivered sont pondérées par des probabilités observées ou par des hypothèses provisoires explicitement signalées.',
      confidence: dataQuality.confidence,
      calibration: backtests.length >= 3 ? 'Ajustement progressif selon les résultats signés observés.' : 'Calibration automatique en attente de trois périodes de comparaison complètes.'
    }
  };
}

module.exports = { buildForecast, orderDate, statusOf, estimateCents, confirmedCents, signedCents, isCanceled, isSigned, isDelivered };
