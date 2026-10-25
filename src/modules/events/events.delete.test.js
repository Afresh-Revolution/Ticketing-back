import test from 'node:test';
import assert from 'node:assert/strict';

// Never connect to the configured application database in regression tests.
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
const { pool } = await import('../../shared/config/db.js');
const { deleteEvent } = await import('./events.controller.js');

async function run(t, { role = 'superadmin', userId = 0, event = { id: 'event-1', createdBy: 42 }, fail = false } = {}) {
  const calls = [];
  let released = false;
  t.mock.method(pool, 'connect', async () => ({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT')) return { rows: event ? [event] : [] };
      if (fail && sql.startsWith('DELETE FROM "Order"')) throw new Error('database failure');
      // Simulate the FK that made the old direct DELETE fail.
      if (sql.startsWith('DELETE FROM "Event"')) {
        assert.ok(calls.some(c => c.sql.startsWith('DELETE FROM "Order"')));
        assert.ok(calls.some(c => c.sql.startsWith('DELETE FROM "OrderItem"')));
      }
      return { rows: [], rowCount: 1 };
    },
    release() { released = true; },
  }));
  t.mock.method(console, 'error', () => {});
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await deleteEvent({ params: { id: 'event-1' }, userRole: role, userId }, res);
  assert.equal(released, true);
  return { res, calls };
}

test('superadmin deletes another admin event and its dependencies in one transaction', async t => {
  const { res, calls } = await run(t);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { message: 'Deleted' });
  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /FOR UPDATE/);
  assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.ok(calls.filter(c => c.sql.startsWith('DELETE')).every(c => c.params[0] === 'event-1'));
});

test('event owner can delete with a string user ID', async t => {
  const { res } = await run(t, { role: 'admin', userId: '42' });
  assert.equal(res.statusCode, 200);
});

test('another admin is denied before deleting dependent records', async t => {
  const { res, calls } = await run(t, { role: 'admin', userId: 7 });
  assert.equal(res.statusCode, 403);
  assert.ok(!calls.some(c => c.sql.startsWith('DELETE')));
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});

test('missing event returns 404 without deleting records', async t => {
  const { res, calls } = await run(t, { event: null });
  assert.equal(res.statusCode, 404);
  assert.ok(!calls.some(c => c.sql.startsWith('DELETE')));
});

test('database failure rolls back cleanup and returns 500 instead of 404', async t => {
  const { res, calls } = await run(t, { fail: true });
  assert.equal(res.statusCode, 500);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!calls.some(c => c.sql === 'COMMIT'));
  assert.ok(!calls.some(c => c.sql.startsWith('DELETE FROM "Event"')));
});
