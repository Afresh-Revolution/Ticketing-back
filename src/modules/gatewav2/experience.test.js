import assert from 'node:assert/strict';
import test from 'node:test';
import {
  budgetSummary,
  canAddMemory,
  canRemoveMember,
  canTransition,
  canonicalRsvp,
  circlePowers,
  displayRsvp,
  inviteStatusFor,
  inviteUsable,
  singleChoiceBallot,
  tallyPoll,
  ticketStatusFor,
  validateCircleBody,
  validatePlanBody,
} from './experienceRules.js';

test('circle creation requires a name and an adult confirmation', () => {
  assert.equal(validateCircleBody({ name: '', adultConfirmed: true }, { creating: true }), 'Circle name is required');
  assert.equal(validateCircleBody({ name: 'Friday', adultConfirmed: false }, { creating: true }), 'Confirm you are 18 or older to create a circle');
  assert.equal(validateCircleBody({ name: 'Friday', adultConfirmed: true, category: 'friends' }, { creating: true }), null);
});

test('member permissions are enforced separately from the owner', () => {
  const member = circlePowers({ memberCanInvite: false, memberCanCreatePlans: false }, { role: 'member', userId: 2 }, false);
  assert.equal(member.invite, false);
  assert.equal(member.createPlans, false);
  assert.equal(member.assignRoles, false);
  assert.equal(member.deleteCircle, false);
  const admin = circlePowers({ memberCanInvite: false }, { role: 'admin', userId: 3 }, false);
  assert.equal(admin.invite, true);
  assert.equal(admin.removeMembers, true);
  assert.equal(admin.transfer, false);
  const owner = circlePowers({}, { role: 'owner', userId: 1 }, true);
  assert.equal(owner.assignRoles, true);
  assert.equal(canRemoveMember(admin, 3, { userId: 9, role: 'member' }), true);
  assert.equal(canRemoveMember(admin, 3, { userId: 1, role: 'owner' }), false);
  assert.equal(canRemoveMember(admin, 3, { userId: 4, role: 'admin' }), false);
});

test('personal plans can confirm without a vote and become group plans without a new id', () => {
  const problem = validatePlanBody({ name: 'Solo show', kind: 'personal', activityType: 'event' });
  assert.equal(problem, null);
  assert.equal(canTransition('draft', 'confirmed', 'personal'), true);
  assert.equal(canTransition('draft', 'confirmed', 'group'), false);
  assert.equal(canTransition('voting', 'confirmed', 'group'), true);
  assert.equal(canTransition('completed', 'cancelled', 'group'), false);
  assert.equal(canTransition('open', 'confirmed', 'group'), true);
});

test('a single-choice ballot replaces earlier votes and tallies ties', () => {
  const ballot = singleChoiceBallot(['a', 'b', 'c'], 'b');
  assert.deepEqual(ballot.deleteOptionIds, ['a', 'c']);
  assert.equal(ballot.choice, 'yes');
  assert.equal(singleChoiceBallot(['a'], 'z').error, 'That choice is not in this poll');
  const tally = tallyPoll(
    [{ id: 'a', label: 'Friday' }, { id: 'b', label: 'Saturday' }],
    [{ optionId: 'a', choice: 'yes' }, { optionId: 'b', choice: 'yes' }],
  );
  assert.equal(tally.tie, true);
  assert.equal(tally.leaders.length, 2);
  const winner = tallyPoll(
    [{ id: 'a', label: 'Friday' }, { id: 'b', label: 'Saturday' }],
    [{ optionId: 'a', choice: 'yes' }, { optionId: 'a', choice: 'yes' }],
  );
  assert.equal(winner.tie, false);
  assert.equal(winner.leaders[0].id, 'a');
});

test('rsvp values stay distinct from ticket and check-in states', () => {
  assert.equal(canonicalRsvp('tentative'), 'maybe');
  assert.equal(canonicalRsvp('declined'), 'not_going');
  assert.equal(displayRsvp('going'), 'Going');
  assert.equal(inviteStatusFor('invited'), 'invited');
  assert.equal(inviteStatusFor('going'), 'accepted');
  assert.equal(ticketStatusFor('paid', false), 'paid');
  assert.equal(ticketStatusFor('paid', true), 'checked_in');
  assert.equal(ticketStatusFor(null, false), 'none');
  assert.notEqual(ticketStatusFor('paid', false), canonicalRsvp('going'));
});

test('budget math divides the estimate and never treats it as a payment', () => {
  const summary = budgetSummary(
    [{ amount: 2000, category: 'food' }, { amount: 1000, category: 'transport' }],
    0,
    0,
    null,
    2,
  );
  assert.equal(summary.total, 3000);
  assert.equal(summary.perPerson, 1500);
  const stated = budgetSummary([], 1000, 4000, 900, 4);
  assert.equal(stated.perPerson, 900);
  assert.equal(stated.total, 4000);
});

test('expired, revoked, and rejected invites cannot be used', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(inviteUsable({ expiresAt: future, status: 'pending' }), true);
  assert.equal(inviteUsable({ expiresAt: past, status: 'pending' }), false);
  assert.equal(inviteUsable({ expiresAt: future, revokedAt: future, status: 'pending' }), false);
  assert.equal(inviteUsable({ expiresAt: future, status: 'rejected' }), false);
});

test('memories are only allowed after completion', () => {
  assert.equal(canAddMemory('completed'), true);
  assert.equal(canAddMemory('voting'), false);
  assert.equal(canAddMemory('open'), false);
  assert.equal(canTransition('in_progress', 'completed', 'group'), true);
});
