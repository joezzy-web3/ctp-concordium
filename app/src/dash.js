// Shared dashboard pieces for every role's space: the sidebar with sections, the three
// tiles, the "who acts next" list, the readiness rows and the payout-hold ring.
// The buyer dashboard set the look; supplier, signer and referee reuse it here.
import { ESCROW, isDemo, currentAccount } from './chain.js';
import { microToCcd } from './codec.js';
import { h, icon, chip, short, countdown } from './ui.js';

export const CONTRACT_URL = `https://testnet.ccdscan.io/?dcount=1&dentity=contract&dcontractAddressIndex=${ESCROW.index}&dcontractAddressSubIndex=${ESCROW.subindex}`;

/** Sidebar with the person, the sections of their space, and the escrow link.
 *  items: [[sub, label, icon]]; '' is the dashboard. */
export function navSide({ initial, title, role, items, cur, note }) {
  const me = currentAccount();
  const item = ([key, label, ico]) => h('a', { href: `#/${role}${key ? `/${key}` : ''}`, class: cur === key ? 'on' : null, 'aria-current': cur === key ? 'page' : null }, icon(ico, 18), label);
  return h('aside.side',
    h('div.who', h('span.avatar', initial), h('div', h('b', title), h('span.mono', me ? short(me) : 'Not connected'))),
    h('nav', { 'aria-label': `${title} sections` }, items.map(item)),
    note ? h('p.side-note', note) : null,
    h('div.side-foot', h('a', { href: CONTRACT_URL, target: '_blank', rel: 'noopener' }, `Escrow <${ESCROW.index},${ESCROW.subindex}>`, icon('external', 14)), h('a.side-switch', { href: '#/start' }, isDemo ? 'Start your own escrow' : 'Switch escrow')));
}

export const tile = (cls, label, value, foot) => h(`div.tile.${cls}`, h('span', label), h('b.num', value), h('small', foot));

/** A readiness row: tone ok | hold | no. */
export const row = (tone, title, text, extra) => h('li.ready', h(`span.ready-ico.${tone}`, icon(tone === 'ok' ? 'check' : tone === 'hold' ? 'clock' : 'alert', 16)), h('div', h('b', title), h('span', text), extra));

export const ccd = (micro) => `${microToCcd(micro)} CCD`;
export const sum = (list) => list.reduce((x, o) => x + o.amount, 0n);
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Who acts next" list. entries: { o, what, tone, label, mine } — mine marks the ones this person must act on. */
export function attnPanel(title, href, linkText, entries, empty) {
  return h('section.panel.attn',
    h('div.panel-row', h('h3', title), h('a.inline', { href }, linkText, icon('arrow', 14))),
    entries.length ? h('ul.attn-list', entries.map((e) => h('li', { class: e.mine ? 'yours' : null },
      h('a', { href },
        h('span.order-id.num', `#${e.o.id}`),
        h('span.attn-what', h('b.num', ccd(e.o.amount)), h('span', e.what)),
        chip(e.tone, e.label)))))
      : h('div.empty-s', h('p', empty)));
}

/** Ring showing how much of a hold has passed. */
export function holdRing(start, holdMs, now = Date.now()) {
  const end = start + holdMs;
  const done = Math.min(1, Math.max(0, (now - start) / holdMs));
  const left = end > now;
  return h('div.ring', { style: { '--p': `${Math.round(done * 100)}%` }, role: 'img', 'aria-label': `${Math.round(done * 100)}% of the payout hold has passed` },
    h('div.ring-in', h('b.num', left ? countdown(end - now) : 'Done'), h('span', left ? 'left' : 'hold passed')));
}

export const dashHead = (title, text, action) => h('header.dash-h', h('div', h('h2', title), h('p', text)), action ?? null);
export const unreadable = (title) => h('section.panel', h('header.panel-h', h('h2', title)), h('p.err', icon('alert', 16), 'Could not read the escrow contract right now. Check your connection, then reload.'));
