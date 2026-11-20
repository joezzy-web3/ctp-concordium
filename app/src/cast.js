// The demo cast on testnet (public addresses). Used to prefill forms and to tell a
// connected account which page is theirs. The contract itself decides who may act.
import { AGENT } from './chain.js';

const PEOPLE = {
  '4QzE6ZTUg2j5FCH4fxyvNLEvcmuY3w8PrTZ66qjqocycEmTthG': { role: 'buyer', name: 'Buyer' },
  '3NrB4khEwjL32cM8qVsay6iHTRznthBFPNCG6GvmLNQygyVE2S': { role: 'signer', name: 'Receiver' },
  '3byivDufzZzRRFasdEcL6pYM9zyyER73kaYvraPWb1rVixy9pA': { role: 'signer', name: 'Approver' },
  '45H81t8SBw5z84LjPcX3VFZRWPrcEKv3bTbao8yC5hbP2BixMY': { role: 'supplier', name: 'Lagos Foods Ltd (demo supplier)' },
  [AGENT.owner]: { role: 'agent', name: `Agent #${AGENT.id}` },
};

export const CAST = {
  buyer: '4QzE6ZTUg2j5FCH4fxyvNLEvcmuY3w8PrTZ66qjqocycEmTthG',
  receiver: '3NrB4khEwjL32cM8qVsay6iHTRznthBFPNCG6GvmLNQygyVE2S',
  approver: '3byivDufzZzRRFasdEcL6pYM9zyyER73kaYvraPWb1rVixy9pA',
  supplier: '45H81t8SBw5z84LjPcX3VFZRWPrcEKv3bTbao8yC5hbP2BixMY',
  supplierName: 'Lagos Foods Ltd',
  agent: AGENT.owner,
  /** Set to the demo referee's account once it exists (a second identity). */
  referee: '',
  nameOf: (a) => (PEOPLE[a]?.name ?? 'Account').replace(' (demo supplier)', ''),
};

export const roleOf = (a) => PEOPLE[a]?.role ?? null;
