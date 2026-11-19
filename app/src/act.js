import { send, waitFinal, ccdscanTx } from './chain.js';
import { h, icon, notice } from './ui.js';

// ---------- shared transaction flow ----------
/** Sends, waits for finalization and tells the person what happened, in words. */
export async function act(entrypoint, params, { micro = 0n, done, pending } = {}) {
  let tx;
  try {
    tx = await send(entrypoint, params, micro);
  } catch (e) {
    notice('no', h('b', 'Not sent. '), String(e?.message ?? e));
    return { ok: false };
  }
  const n = notice('wait', h('b', pending ?? 'Sent. '), 'Waiting for the chain to finalize it.');
  const r = await waitFinal(tx);
  n.remove();
  const link = h('a', { href: ccdscanTx(tx), target: '_blank', rel: 'noopener' }, 'See it on CCDScan', icon('external', 14));
  if (r.ok === true) notice('ok', h('b', done ?? 'Done.'), ' ', link);
  else if (r.ok === false) notice('no', h('b', 'Refused. '), r.reason, ' ', link);
  else notice('wait', h('b', 'Sent. '), r.reason, ' ', link);
  return r;
}

