// Who is who on the open escrow. On the demo escrow this is the demo cast on testnet
// (public addresses), so anyone can walk the whole flow. On a buyer's own escrow it is the
// list that buyer saved when setting it up, kept in this browser. Used to prefill forms and
// to name accounts on screen; the contract itself decides who may act.
import { AGENT, ESCROW, isDemo } from './chain.js';

const DEMO = {
  buyer: '4QzE6ZTUg2j5FCH4fxyvNLEvcmuY3w8PrTZ66qjqocycEmTthG',
  receiver: '3NrB4khEwjL32cM8qVsay6iHTRznthBFPNCG6GvmLNQygyVE2S',
  approver: '3byivDufzZzRRFasdEcL6pYM9zyyER73kaYvraPWb1rVixy9pA',
  supplier: '45H81t8SBw5z84LjPcX3VFZRWPrcEKv3bTbao8yC5hbP2BixMY',
  supplierName: 'Lagos Foods Ltd',
  agent: AGENT.owner,
  agentId: AGENT.id,
  /** The demo referee: an independent account outside the cast. */
  referee: '3LCLzA5KpFWKpuPUEQvzMhYe2x46aC5Yr763gwvJHvTT8MoTJ9',
};

const castKey = (index) => `ctp:cast:${index}`;
function saved(index) {
  try { return JSON.parse(localStorage.getItem(castKey(index))) ?? null; } catch { return null; }
}
/** Save a buyer's own cast for an escrow (this browser only). */
export function saveCast(index, c) {
  try { localStorage.setItem(castKey(index), JSON.stringify(c)); } catch { /* storage unavailable */ }
}

const own = isDemo ? null : saved(ESCROW.index);
const base = isDemo ? DEMO : {
  buyer: own?.buyer ?? '',
  receiver: own?.receiver ?? '',
  approver: own?.approver ?? '',
  supplier: own?.supplier ?? '',
  supplierName: own?.supplierName || 'Supplier',
  agent: own?.agent ?? AGENT.owner,
  agentId: own?.agentId ?? AGENT.id,
  referee: own?.referee ?? '',
};

const PEOPLE = {};
const add = (a, role, name) => { if (a && !PEOPLE[a]) PEOPLE[a] = { role, name }; };
add(base.buyer, 'buyer', 'Buyer');
add(base.receiver, 'signer', 'Receiver');
add(base.approver, 'signer', 'Approver');
add(base.supplier, 'supplier', base.supplierName);
add(base.agent, 'agent', `Agent #${base.agentId}`);

export const CAST = {
  ...base,
  /** True once this escrow has a cast to prefill with (always on the demo). */
  ready: isDemo || Boolean(own),
  nameOf: (a) => PEOPLE[a]?.name ?? 'Account',
};

export const roleOf = (a) => PEOPLE[a]?.role ?? null;
