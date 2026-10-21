import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSessionInstants, zonedTimeToUtc } from './recurrence.js';

test('weekly local time stays at 10:00 across US DST', () => {
  const before = zonedTimeToUtc(2026, 2, 1, 10, 0, 'America/New_York');
  const after = zonedTimeToUtc(2026, 2, 15, 10, 0, 'America/New_York');
  const beforeHour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(before);
  const afterHour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(after);
  assert.equal(beforeHour, '10');
  assert.equal(afterHour, '10');
  assert.notEqual(before.getUTCHours(), after.getUTCHours());
});

test('weekly series is bounded and skips a blackout without deleting the series', () => {
  const sessions = generateSessionInstants({
    startDate: '2026-10-05',
    startTime: '18:00',
    frequency: 'weekly',
    weekday: 'monday',
    until: '2026-12-31',
    timeZone: 'Africa/Lagos',
    blackouts: ['2026-10-12'],
    max: 52,
  });
  assert.ok(sessions.length > 2);
  assert.ok(sessions.length <= 52);
  assert.equal(sessions.some((s) => s.localDate === '2026-10-12'), false);
  assert.equal(sessions[0].localDate, '2026-10-05');
  const again = generateSessionInstants({
    startDate: '2026-10-05',
    startTime: '18:00',
    frequency: 'weekly',
    weekday: 'monday',
    until: '2026-12-31',
    timeZone: 'Africa/Lagos',
    blackouts: ['2026-10-12'],
    max: 52,
  });
  assert.deepEqual(again.map((s) => s.startsAt), sessions.map((s) => s.startsAt));
});

test('Lagos offset is UTC+1', () => {
  const instant = zonedTimeToUtc(2026, 9, 21, 19, 0, 'Africa/Lagos');
  assert.equal(instant.toISOString(), '2026-10-21T18:00:00.000Z');
});
