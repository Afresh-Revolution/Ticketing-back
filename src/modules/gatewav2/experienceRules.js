const LIFECYCLE = ['draft', 'voting', 'confirmed', 'upcoming', 'in_progress', 'completed', 'cancelled'];

const CIRCLE_CATEGORIES = ['friends', 'entertainment', 'campus', 'creatives', 'professional', 'family', 'travel', 'other'];

const ACTIVITY_TYPES = ['event', 'hangout', 'concert', 'game', 'creative', 'outdoor', 'custom'];

const BUDGET_CATEGORIES = ['ticket', 'transport', 'food', 'custom'];

export function normalizeLifecycle(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'open') return 'voting';
  return LIFECYCLE.includes(raw) ? raw : 'voting';
}

export function canTransition(from, to, kind = 'group') {
  const current = normalizeLifecycle(from);
  const next = String(to || '').trim().toLowerCase();
  if (!LIFECYCLE.includes(next)) return false;
  if (current === next) return true;
  if (next === 'cancelled') return current !== 'completed' && current !== 'cancelled';
  const order = ['draft', 'voting', 'confirmed', 'upcoming', 'in_progress', 'completed'];
  const start = order.indexOf(current);
  const end = order.indexOf(next);
  if (start < 0 || end < 0) return false;
  if (end === start + 1) return true;
  return kind === 'personal' && current === 'draft' && next === 'confirmed';
}

export function canonicalRsvp(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'going') return 'going';
  if (raw === 'maybe' || raw === 'tentative') return 'maybe';
  if (raw === 'not_going' || raw === 'declined') return 'not_going';
  if (raw === 'interested') return 'interested';
  if (raw === 'invited') return 'invited';
  return null;
}

export function displayRsvp(value) {
  const raw = canonicalRsvp(value) || String(value || '');
  if (raw === 'going') return 'Going';
  if (raw === 'maybe') return 'Maybe';
  if (raw === 'not_going') return 'Not going';
  if (raw === 'interested') return 'Interested';
  return 'Invited';
}

export function inviteStatusFor(rsvp) {
  const raw = canonicalRsvp(rsvp) || 'invited';
  return raw === 'invited' ? 'invited' : 'accepted';
}

export function ticketStatusFor(orderStatus, stamped) {
  if (stamped) return 'checked_in';
  const status = String(orderStatus || '').toLowerCase();
  if (status === 'paid' || status === 'completed' || status === 'success') return 'paid';
  return 'none';
}

export function circleRole(circle, membership, isOwnerFlag) {
  if (isOwnerFlag || Number(circle?.ownerUserId) === Number(membership?.userId)) return 'owner';
  if (membership?.role === 'admin') return 'admin';
  if (membership?.role === 'owner') return 'owner';
  return 'member';
}

export function circlePowers(circle, membership, isOwnerFlag) {
  const role = circleRole(circle, membership, isOwnerFlag);
  const owner = role === 'owner';
  const admin = owner || role === 'admin';
  return {
    role,
    manageSettings: owner,
    assignRoles: owner,
    removeMembers: admin,
    invite: admin || Boolean(circle?.memberCanInvite),
    createPlans: admin || circle?.memberCanCreatePlans !== false,
    deleteCircle: owner,
    transfer: owner,
    moderate: admin,
  };
}

export function canRemoveMember(powers, actorId, target) {
  if (!powers?.removeMembers) return false;
  if (Number(actorId) === Number(target?.userId)) return false;
  if (target?.role === 'owner') return false;
  if (powers.role === 'admin' && target?.role === 'admin') return false;
  return true;
}

export function tallyPoll(options, votes) {
  const rows = (options || []).map((option) => ({
    id: option.id,
    label: option.label || option.proposedDate || 'Option',
    count: (votes || []).filter((vote) => vote.optionId === option.id && (vote.choice === 'yes' || vote.choice === option.id)).length,
  }));
  const max = rows.reduce((highest, row) => Math.max(highest, row.count), 0);
  const leaders = max > 0 ? rows.filter((row) => row.count === max) : [];
  return { options: rows, leaders, tie: leaders.length > 1, total: rows.reduce((sum, row) => sum + row.count, 0) };
}

export function singleChoiceBallot(optionIds, optionId) {
  const ids = (optionIds || []).map(String);
  if (!ids.includes(String(optionId))) return { error: 'That choice is not in this poll' };
  return { optionId: String(optionId), deleteOptionIds: ids.filter((id) => id !== String(optionId)), choice: 'yes' };
}

export function budgetSummary(items, budgetMin, budgetMax, perPersonInput, goingCount) {
  const itemTotal = (items || []).reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0);
  const ranged = Number(budgetMax ?? budgetMin ?? 0) || 0;
  const total = itemTotal > 0 ? itemTotal : Math.max(0, ranged);
  const people = Math.max(1, Number(goingCount) || 0);
  const perPerson = perPersonInput != null && perPersonInput !== ''
    ? Math.max(0, Math.round(Number(perPersonInput) || 0))
    : Math.round(total / people);
  return { itemTotal, total, perPerson, people };
}

export function inviteUsable(row, now = Date.now()) {
  if (!row || row.revokedAt) return false;
  const status = String(row.status || 'pending');
  if (status === 'rejected' || status === 'revoked') return false;
  const expires = new Date(row.expiresAt).getTime();
  return Number.isFinite(expires) && expires > now;
}

export function canAddMemory(lifecycle) {
  return normalizeLifecycle(lifecycle) === 'completed';
}

export function validateCircleBody(body, { creating = false } = {}) {
  const name = String(body?.name || '').trim();
  if (creating && !name) return 'Circle name is required';
  if (name && name.length > 80) return 'Circle name is too long';
  if (creating && !body?.adultConfirmed) return 'Confirm you are 18 or older to create a circle';
  const category = body?.category != null ? String(body.category).trim().toLowerCase() : '';
  if (category && !CIRCLE_CATEGORIES.includes(category)) return 'Choose a circle category';
  const description = body?.description != null ? String(body.description) : '';
  if (description.length > 280) return 'Keep the description under 280 characters';
  return null;
}

export function validatePlanBody(body) {
  const name = String(body?.name || '').trim();
  if (!name) return 'Plan name is required';
  if (name.length > 120) return 'Plan name is too long';
  const kind = body?.kind != null ? String(body.kind) : 'group';
  if (kind !== 'personal' && kind !== 'group') return 'Choose just you or a group';
  const activity = body?.activityType != null ? String(body.activityType) : '';
  if (activity && !ACTIVITY_TYPES.includes(activity)) return 'Choose what you are planning';
  const lifecycle = body?.lifecycle != null ? String(body.lifecycle) : '';
  if (lifecycle && !LIFECYCLE.includes(lifecycle) && lifecycle !== 'open') return 'That plan status is not valid';
  for (const key of ['budgetMin', 'budgetMax', 'perPerson']) {
    if (body?.[key] == null || body[key] === '') continue;
    const amount = Number(body[key]);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) return 'Enter a budget amount in naira';
  }
  const notes = body?.notes != null ? String(body.notes) : '';
  if (notes.length > 500) return 'Keep notes under 500 characters';
  const location = body?.location != null ? String(body.location) : '';
  if (location.length > 160) return 'Location is too long';
  return null;
}

export function validateBudgetItem(body) {
  const category = String(body?.category || 'custom').toLowerCase();
  if (!BUDGET_CATEGORIES.includes(category)) return 'Choose a cost category';
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) return 'Enter an amount in naira';
  const label = body?.label != null ? String(body.label) : '';
  if (label.length > 80) return 'That label is too long';
  return null;
}

export function httpsUrl(value) {
  const text = String(value || '').trim();
  if (!text) return { url: null };
  if (!/^https:\/\/\S{3,500}$/i.test(text)) return { error: 'Upload the photo again' };
  return { url: text };
}

export const CIRCLE_CATEGORY_LIST = CIRCLE_CATEGORIES;
export const ACTIVITY_TYPE_LIST = ACTIVITY_TYPES;
export const BUDGET_CATEGORY_LIST = BUDGET_CATEGORIES;
export const LIFECYCLE_LIST = LIFECYCLE;
