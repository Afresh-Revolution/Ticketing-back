import test from 'node:test';
import assert from 'node:assert/strict';
import { eventHasEnded } from './circleChat.js';

test('an event stays open through the end of its last day', () => {
  const event = { date: new Date(2026, 9, 22), endDate: null, isRecurring: false };
  assert.equal(eventHasEnded(event, new Date(2026, 9, 22, 18, 0, 0)), false);
  assert.equal(eventHasEnded(event, new Date(2026, 9, 23, 0, 0, 1)), true);
});

test('a recurring event lasts until recurrenceUntil', () => {
  const event = {
    date: new Date(2026, 0, 1),
    endDate: new Date(2026, 0, 2),
    isRecurring: true,
    recurrenceUntil: new Date(2026, 5, 1),
  };
  assert.equal(eventHasEnded(event, new Date(2026, 4, 20)), false);
  assert.equal(eventHasEnded(event, new Date(2026, 5, 2)), true);
});

test('a missing event is treated as ended', () => {
  assert.equal(eventHasEnded(null, new Date(2026, 0, 1)), true);
});
