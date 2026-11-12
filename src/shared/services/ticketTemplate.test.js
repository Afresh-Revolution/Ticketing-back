import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTicketEmail } from './ticketTemplate.js';
import { getTicketDesign } from './ticketDesign.js';

const sample = { eventId: 'event-1', eventTitle: 'A night in Jos', eventDate: '2026-12-20', eventStartTime: '18:00', eventVenue: 'City Hall', fullName: 'Sample Guest', to: 'guest@example.com', ticketCode: 'DEMO-NOT-VALID', totalAmount: 25000, ticketItems: [{ name: 'Balcony', quantity: 1, price: 25000, deliveryMode: 'in_person' }] };
test('price thresholds select finishes without inventing access rights', () => {
  for (const [price, name] of [[0,'MINT'],[1,'EMERALD'],[24999,'EMERALD'],[25000,'GOLD'],[99999,'GOLD'],[100000,'OBSIDIAN']]) {
    assert.equal(getTicketDesign({ items: [{ price, quantity: 1 }], totalAmount: price }).name, name);
  }
  assert.equal(getTicketDesign({ items: [{price: 5000, quantity: 100}], totalAmount: 500000 }).name, 'EMERALD');
});
test('mixed orders use highest unit price and fallback divides quantity', () => {
  assert.equal(getTicketDesign({ items: [{price: 5000}, {price: 100000}], totalAmount: 105000 }).name, 'OBSIDIAN');
  assert.equal(getTicketDesign({ items: [{quantity: 10}], totalAmount: 50000 }).name, 'EMERALD');
});
test('physical tickets contain QR, holder, paid total and event link', () => {
  const {html,text} = renderTicketEmail(sample, { qrSrc: 'cid:gatewav-entry' });
  assert.match(html, /cid:gatewav-entry/); assert.match(html, /GOLD/); assert.match(html, /TOTAL PAID/);
  assert.match(text, /DEMO-NOT-VALID/); assert.match(text, /event-1/); assert.match(html, /18:00 WAT/);
});
test('online tickets never expose venue entry codes', () => {
  const {html,text} = renderTicketEmail({...sample,eventType:'online'}, { qrSrc: 'cid:gatewav-entry' });
  assert.doesNotMatch(html, /cid:gatewav-entry|DEMO-NOT-VALID|SCAN AT ENTRY/);
  assert.doesNotMatch(text, /DEMO-NOT-VALID/); assert.match(html, /private watch link/);
});
test('hybrid online-only and mixed purchases keep correct access modes', () => {
  const online = {...sample.ticketItems[0],deliveryMode:'online'};
  assert.doesNotMatch(renderTicketEmail({...sample,eventType:'hybrid',ticketItems:[online]}).html, /DEMO-NOT-VALID/);
  const mixed = renderTicketEmail({...sample,eventType:'hybrid',ticketItems:[online,...sample.ticketItems]}, {qrSrc:'cid:gatewav-entry'}).html;
  assert.match(mixed, /private watch link/); assert.match(mixed, /cid:gatewav-entry/);
});
test('untrusted content is escaped and unsafe image URLs are excluded', () => {
  const {html,subject} = renderTicketEmail({...sample,eventTitle:'<script>bad</script>\nSubject',fullName:'<img onerror="bad">',eventImageUrl:'javascript:bad'});
  assert.doesNotMatch(html, /<script>|<img onerror|javascript:bad/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(subject, /[\r\n]/);
});
test('unknown totals do not become a misleading zero-paid receipt', () => {
  assert.doesNotMatch(renderTicketEmail({...sample,totalAmount:null}).html, /TOTAL PAID/);
});
test('QR generation failure leaves the human-readable entry code', () => {
  const {html} = renderTicketEmail(sample);
  assert.match(html,/DEMO-NOT-VALID/); assert.doesNotMatch(html,/src="cid:/);
});
