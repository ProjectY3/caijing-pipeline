const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

const HOLIDAYS_2026 = new Set([
  '2026-01-01',
  '2026-01-02',
  '2026-01-03',
  '2026-02-15',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-02-21',
  '2026-02-22',
  '2026-02-23',
  '2026-04-04',
  '2026-04-05',
  '2026-04-06',
  '2026-05-01',
  '2026-05-02',
  '2026-05-03',
  '2026-05-04',
  '2026-05-05',
  '2026-06-19',
  '2026-06-20',
  '2026-06-21',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
]);

function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    weekday: map.weekday,
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayOf(dateText) {
  return new Date(`${dateText}T00:00:00Z`).getUTCDay();
}

function isTradingDay(dateText) {
  const day = weekdayOf(dateText);
  return day !== 0 && day !== 6 && !HOLIDAYS_2026.has(dateText);
}

function nextTradingDay(dateText, options = {}) {
  let candidate = options.includeToday ? dateText : addDays(dateText, 1);
  for (let guard = 0; guard < 370; guard += 1) {
    if (isTradingDay(candidate)) return candidate;
    candidate = addDays(candidate, 1);
  }
  throw new Error(`cannot find next trading day after ${dateText}`);
}

function minutesSinceMidnight(parts) {
  return parts.hour * 60 + parts.minute + (parts.second > 0 ? 1 / 60 : 0);
}

function getTradingSessionStatus(now = new Date()) {
  const parts = shanghaiParts(now);
  if (!isTradingDay(parts.date)) {
    return { code: 'closed', label: '非交易日', date: parts.date };
  }

  const minutes = minutesSinceMidnight(parts);
  if (minutes < 9 * 60 + 30) return { code: 'before_open', label: '未开盘', date: parts.date };
  if (minutes < 11 * 60 + 30) return { code: 'open', label: '交易中', date: parts.date };
  if (minutes < 13 * 60) return { code: 'lunch_break', label: '午间休市', date: parts.date };
  if (minutes < 15 * 60) return { code: 'open', label: '交易中', date: parts.date };
  return { code: 'after_close', label: '已收盘', date: parts.date };
}

function getTradingContext(now = new Date()) {
  const parts = shanghaiParts(now);
  const today = parts.date;
  const todayTrading = isTradingDay(today);
  const tomorrow = addDays(today, 1);
  return {
    date: today,
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`,
    is_trading_day: todayTrading,
    session: getTradingSessionStatus(now),
    tomorrow,
    tomorrow_is_trading_day: isTradingDay(tomorrow),
    next_trading_day: nextTradingDay(today),
  };
}

function formatTradingContext(context) {
  return [
    `Trading calendar: ${context.date} ${context.is_trading_day ? '交易日' : '非交易日'}，${context.session.label}`,
    `Tomorrow: ${context.tomorrow} ${context.tomorrow_is_trading_day ? '交易日' : '非交易日'}`,
    `Next trading day: ${context.next_trading_day}`,
  ].join('\n');
}

module.exports = {
  HOLIDAYS_2026,
  formatTradingContext,
  getTradingContext,
  getTradingSessionStatus,
  isTradingDay,
  nextTradingDay,
  shanghaiParts,
};
