const WEEKDAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Milliseconds to add to UTC to get the wall clock in `timeZone`. */
export function tzOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** Convert a civil date and time in `timeZone` to a UTC Date. DST-safe via offset iteration. */
export function zonedTimeToUtc(year, monthIndex, day, hour, minute, timeZone) {
  const wallAsUtc = Date.UTC(year, monthIndex, day, hour, minute, 0);
  let guess = wallAsUtc - tzOffsetMs(new Date(wallAsUtc), timeZone);
  const second = wallAsUtc - tzOffsetMs(new Date(guess), timeZone);
  if (second !== guess) guess = second;
  return new Date(guess);
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
  }
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '19:00'));
  if (!match) return { hour: 19, minute: 0 };
  return { hour: Math.min(23, Number(match[1])), minute: Math.min(59, Number(match[2])) };
}

function addDays(year, month, day, amount) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + amount);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function weekdayOf(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function compareDates(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function dateKey(d) {
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/**
 * Build future session instants for a recurring template.
 * Bounded, timezone-safe, and stable: the same inputs always return the same instants.
 */
export function generateSessionInstants({
  startDate,
  startTime,
  frequency,
  weekday,
  until,
  timeZone = 'Africa/Lagos',
  max = 52,
  blackouts = [],
}) {
  const freq = String(frequency || 'none').toLowerCase();
  if (!['daily', 'weekly', 'biweekly', 'monthly'].includes(freq)) return [];
  const start = parseDate(startDate);
  if (!start) return [];
  const time = parseTime(startTime);
  const untilDate = parseDate(until) || addDays(start.year, start.month, start.day, freq === 'daily' ? 60 : 180);
  const blackoutSet = new Set(blackouts.map((d) => String(d).slice(0, 10)));
  const cap = Math.min(Math.max(1, Number(max) || 52), 52);
  const out = [];

  let cursor = { ...start };
  if (freq === 'weekly' || freq === 'biweekly') {
    const target = WEEKDAYS[String(weekday || '').toLowerCase()];
    if (target != null) {
      const delta = (target - weekdayOf(cursor.year, cursor.month, cursor.day) + 7) % 7;
      cursor = addDays(cursor.year, cursor.month, cursor.day, delta);
    }
  }

  const step = freq === 'daily' ? 1 : freq === 'weekly' ? 7 : freq === 'biweekly' ? 14 : 0;
  let guard = 0;
  while (out.length < cap && guard < 400 && compareDates(cursor, untilDate) <= 0) {
    guard += 1;
    const key = dateKey(cursor);
    if (!blackoutSet.has(key)) {
      const startsAt = zonedTimeToUtc(cursor.year, cursor.month - 1, cursor.day, time.hour, time.minute, timeZone);
      out.push({
        id: '',
        localDate: key,
        startsAt: startsAt.toISOString(),
        timeZone,
      });
    }
    if (freq === 'monthly') {
      const nextMonth = cursor.month === 12 ? 1 : cursor.month + 1;
      const nextYear = cursor.month === 12 ? cursor.year + 1 : cursor.year;
      const dim = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
      cursor = { year: nextYear, month: nextMonth, day: Math.min(start.day, dim) };
    } else {
      cursor = addDays(cursor.year, cursor.month, cursor.day, step);
    }
  }
  return out;
}
