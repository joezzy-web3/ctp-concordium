// Spaces still being built: point to the working console for now, honestly.
import { h, icon } from './ui.js';

const NEXT = {
  signer: ['Delivery signer space', 'Count, commit and reveal with live order status. Until it lands, signers can commit and reveal in the console.'],
  supplier: ['Supplier space', 'Invoice approval with the amount shown large, payout account and hold. Until it lands, use the console.'],
  agent: ['Agent space', 'Badge check, invoice submission and payment requests. Until it lands, use the console.'],
  judge: ['Judge mode', 'Each attack runs against the real contract and shows why it fails. Being built next.'],
};

export function placeholderView(role) {
  const [title, text] = NEXT[role];
  return h('section.panel.soon',
    h('h2', title),
    h('p', text),
    role !== 'judge' ? h('a.btn.line', { href: '../console/' }, 'Open the console', icon('external', 16)) : null);
}
