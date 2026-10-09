// Change markers shared by flow and tree: a line that starts with "+ ", "- " or "~ " shows what a plan adds, removes and changes.
// This file reads the marker and draws the parts both components share: the badge, the count row and the Before / Changes / After switch.
import { esc } from '../svg/text.js';

const STATE_OF = { '+': 'added', '-': 'removed', '~': 'changed' };
export const SIGN = { added: '+', removed: '−', changed: '~' };
const STATES = Object.keys(SIGN);

// Labels when a component runs without a page language (component unit tests); the page labels live in src/languages.
const EN_DELTA = { added: 'added', removed: 'removed', changed: 'changed', view: 'View', before: 'Before', changes: 'Changes', after: 'After' };
const labelsOf = (ui) => ({ ...EN_DELTA, ...ui?.delta });

// A marker is + - or ~ followed by a space. Without the space (-Gateway, +1 votes) the line stays plain text.
export function splitMarker(text) {
  const m = text.match(/^([+\-~]) +(\S.*)$/);
  return m ? { mark: m[1], text: m[2] } : { mark: null, text };
}

export const markState = (mark) => STATE_OF[mark] ?? null;

export const deltaAttr = (state) => (state ? ` data-delta="${state}"` : '');

// The small +, − or ~ badge on a tree node; flow draws its own in SVG next to the node shape.
export function deltaBadge(state, ui) {
  if (!state) return '';
  return `<span class="am-delta-badge am-delta-badge--${state}" role="img" aria-label="${esc(labelsOf(ui)[state])}">${SIGN[state]}</span>`;
}

// Adds the count row and the view switch at the end of a drawn component (html is one element whose last attribute is class) when any of its items is marked,
// and gives that element the class am-view-changes; the switch swaps it for am-view-before or am-view-after. A class, not an attribute, because the video
// copies a host's classes onto its morph ghosts. Without a marker the html is returned as it is. The bar sits inside the element, so the figure that holds the
// diagram stays the only child of its panel and the sheet layout sizes it as before.
// states: the state of every marked or unmarked item (null for unmarked). The switch needs the page script, so it starts hidden, and a video leaves it out.
export function withDelta(html, states, { ui, video = false } = {}) {
  const used = STATES.map((s) => [s, states.filter((x) => x === s).length]).filter(([, n]) => n > 0);
  if (!used.length) return html;
  const t = labelsOf(ui);
  // counts: the word after a count above one, for a language whose word changes with the number (Hebrew "נוסף" for one, "נוספו" for 4).
  const word = (s, n) => (n === 1 ? t[s] : (t.counts?.[s] ?? t[s]));
  const counts = used.map(([s, n]) => `<span class="am-delta-count am-delta-count--${s}">${SIGN[s]}${n} ${esc(word(s, n))}</span>`).join(' ');
  const views = ['before', 'changes', 'after'].map((v) => `<button type="button" data-view="${v}" aria-pressed="${v === 'changes'}">${esc(t[v])}</button>`).join('');
  const switcher = video ? '' : `<span class="am-delta-switch" role="group" aria-label="${esc(t.view)}" hidden>${views}</span>`;
  const open = html.indexOf('>');
  const close = html.lastIndexOf('</');
  return `${html.slice(0, open - 1)} am-view-changes"${html.slice(open, close)}<div class="am-delta-bar">${counts}${switcher}</div>${html.slice(close)}`;
}
