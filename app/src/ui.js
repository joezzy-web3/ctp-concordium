// Tiny DOM helpers. Everything is built as nodes; data is never parsed as HTML.

/** h('div.card#id', { onclick, style, dataset, ...attrs }, ...children) */
export function h(spec, props, ...children) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    if (props != null) children.unshift(props);
    props = {};
  }
  const [, tag = 'div', rest = ''] = spec.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(tag || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
/** Replaces an element's content, skipping null/false parts (replaceChildren would print "null"). */
export const fill = (el, ...parts) => el.replaceChildren(...parts.flat(Infinity).filter((x) => x != null && x !== false).map((x) => (x instanceof Node ? x : document.createTextNode(String(x)))));
export const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');

/** Inline SVG icon from a small set, drawn with currentColor (one stroke weight). */
const ICONS = {
  check: 'M4 10.5l4 4 8-9',
  alert: 'M10 6v5M10 14.5v.01M10 2l8 15H2z',
  clock: 'M10 5v5l3 2M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  lock: 'M6 9V6a4 4 0 0 1 8 0v3M4 9h12v9H4z',
  edit: 'M13 3l4 4-9 9H4v-4z',
  download: 'M10 3v10M6 9l4 4 4-4M4 17h12',
  external: 'M11 3h6v6M17 3l-8 8M15 12v5H3V5h5',
  user: 'M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 18c1-4 4-6 7-6s6 2 7 6',
  plus: 'M10 4v12M4 10h12',
  x: 'M5 5l10 10M15 5L5 15',
  arrow: 'M4 10h12M11 5l5 5-5 5',
  grid: 'M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z',
  list: 'M7 5h10M7 10h10M7 15h10M3 5h.01M3 10h.01M3 15h.01',
  calendar: 'M3 5h14v12H3zM3 9h14M7 3v4M13 3v4',
  refresh: 'M16 10a6 6 0 1 1-2-4.5M16 3v4h-4',
  inbox: 'M3 11l2-7h10l2 7v5H3zM3 11h4l1 2h4l1-2h4',
};
export function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ico');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] ?? '');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.8');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

/** Status chip; tone is ok | hold | no | wait | mute. Always text + colour, never colour alone. */
export const chip = (tone, text) => h(`span.chip.${tone}`, text);

/** Toast-style notice at the bottom of the screen. */
export function notice(tone, ...content) {
  const host = $('#notices');
  const n = h(`div.notice.${tone}`, { role: tone === 'no' ? 'alert' : 'status' }, h('div.notice-body', ...content), h('button.notice-x', { 'aria-label': 'Dismiss', onclick: () => n.remove() }, icon('x', 16)));
  host.append(n);
  return n;
}

export function countdown(ms) {
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), hrs = Math.floor((m % 1440) / 60), min = m % 60;
  return d ? `${d}d ${hrs}h` : hrs ? `${hrs}h ${min}m` : `${min}m`;
}

/** A hold length in words: "72 hours", "1 minute". */
export function holdText(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const hrs = Math.round(m / 60);
  return `${hrs} hour${hrs === 1 ? '' : 's'}`;
}
export const fmtDate = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: keep going */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
