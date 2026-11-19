// Reason codes for the counterparty badge gate ("verify before you pay").
//
// Same convention as the Clear to Pay rules engine: the prefix of a code is
// its verdict (REFUSED_*, HELD_*). An agent is CLEARED only when no code fires.
// The gate fails closed: if it cannot check, the answer is HELD, never CLEARED.

export const GATE_CODES = Object.freeze({
  REFUSED_BADGE_MALFORMED: 'REFUSED_BADGE_MALFORMED',       // not a well-formed Agent ID
  REFUSED_AGENT_NOT_REGISTERED: 'REFUSED_AGENT_NOT_REGISTERED', // no agent with this ID in the registry
  REFUSED_AGENT_INACTIVE: 'REFUSED_AGENT_INACTIVE',         // registered, but not Active
  REFUSED_BADGE_INVALID: 'REFUSED_BADGE_INVALID',           // registry says the badge does not check out
  REFUSED_WRONG_NETWORK: 'REFUSED_WRONG_NETWORK',           // badge answered for a different network
  REFUSED_CARD_TAMPERED: 'REFUSED_CARD_TAMPERED',           // our own hash of the card differs from the chain
  REFUSED_OWNER_MISMATCH: 'REFUSED_OWNER_MISMATCH',         // invoice names a different owner than the chain
  HELD_REGISTRY_UNREACHABLE: 'HELD_REGISTRY_UNREACHABLE',   // registry did not answer properly
  HELD_CARD_UNREACHABLE: 'HELD_CARD_UNREACHABLE',           // card could not be fetched and hashed
});

// Order in which codes are reported, so identical inputs give identical output.
export const GATE_ORDER = Object.freeze(Object.values(GATE_CODES));

const RANK = Object.freeze({ CLEARED: 0, HELD: 1, REFUSED: 2 });

/** Most severe verdict among fired codes; CLEARED when none fired. */
export function gateVerdict(codes) {
  let top = 'CLEARED';
  for (const c of codes) {
    const v = c.startsWith('REFUSED_') ? 'REFUSED' : c.startsWith('HELD_') ? 'HELD' : null;
    if (!v) throw new Error(`Unknown gate code: ${c}`);
    if (RANK[v] > RANK[top]) top = v;
  }
  return top;
}
