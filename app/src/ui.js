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
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
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

export const fmtDate = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: keep going */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
