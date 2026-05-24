import { config } from '../config/env.js';

const PAYSTACK_BASE = 'https://api.paystack.co';

function requireSecretKey() {
  const secret = config.paystackSecretKey;
  if (!secret) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured');
  }
  return secret;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${requireSecretKey()}`,
    'Content-Type': 'application/json',
  };
}

async function paystackRequest(path, options = {}) {
  const response = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.status === false) {
    const err = new Error(body?.message || `Paystack request failed (${path})`);
    err.paystack = body;
    err.statusCode = response.status;
    throw err;
  }
  return body?.data ?? body;
}

export function isPaystackConfigured() {
  return Boolean(config.paystackSecretKey);
}

export function generateOrderReference() {
  return `ord_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function generateWithdrawalTransferReference(withdrawalId) {
  const idPart = String(withdrawalId || 'wd').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  return `wd_${idPart}_${Date.now()}`;
}

/** Initialize a Paystack checkout session (amount in kobo). */
export async function initializeTransaction({
  email,
  amountKobo,
  reference,
  callbackUrl,
  metadata,
  currency = 'NGN',
  channels,
}) {
  const payload = {
    email: String(email || '').trim(),
    amount: Math.round(Number(amountKobo) || 0),
    reference: String(reference || generateOrderReference()),
    currency,
    metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
    callback_url: callbackUrl || undefined,
  };
  if (Array.isArray(channels) && channels.length > 0) {
    payload.channels = channels;
  }
  return paystackRequest('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Verify a Paystack transaction by reference. */
export async function verifyTransaction(reference) {
  return paystackRequest(`/transaction/verify/${encodeURIComponent(String(reference))}`, {
    method: 'GET',
  });
}

/** Create a NUBAN transfer recipient on Paystack. */
export async function createTransferRecipient({ accountName, accountNumber, bankCode, currency = 'NGN' }) {
  return paystackRequest('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: 'nuban',
      name: String(accountName || '').trim() || 'Gatewav Admin',
      account_number: String(accountNumber || '').trim(),
      bank_code: String(bankCode || '').trim(),
      currency,
    }),
  });
}

/** Initiate a transfer from Paystack balance (amount in kobo). */
export async function initiateTransfer({ amountKobo, recipientCode, reference, reason }) {
  return paystackRequest('/transfer', {
    method: 'POST',
    body: JSON.stringify({
      source: 'balance',
      amount: Math.round(Number(amountKobo) || 0),
      recipient: String(recipientCode || '').trim(),
      reason: String(reason || 'Gatewav withdrawal').slice(0, 100),
      reference: String(reference || generateOrderReference()),
    }),
  });
}

/** List Nigerian banks from Paystack (paginated). */
export async function listBanks({ perPage = 100, maxPages = 50 } = {}) {
  const byCode = new Map();
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetch(
      `${PAYSTACK_BASE}/bank?currency=NGN&perPage=${perPage}&page=${page}`,
      { headers: authHeaders() }
    );
    const body = await response.json().catch(() => ({}));
    const rows = Array.isArray(body?.data) ? body.data : [];
    if (!response.ok || body?.status === false || rows.length === 0) break;
    for (const bank of rows) {
      if (bank.active === false || bank.supports_transfer === false) continue;
      const code = String(bank.code ?? '').trim();
      const name = String(bank.name ?? '').trim();
      if (code && name && !byCode.has(code)) byCode.set(code, { code, name });
    }
    if (!body?.meta?.next) break;
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
}
