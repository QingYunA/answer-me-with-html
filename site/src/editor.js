// The theme editor (/themes/new/): start from a theme, edit it in a form or as JSON, see it on a sample page, check it with the catalog rules,
// download it or send it as a GitHub issue. The parts that need no page (starting points, the check, the submit link, the issue loader)
// are in editor-model.js, which the renderer bundle (engine.js) carries, so node tests them.
import { copyText, track } from './main.js';
import { UI, BASE, siteMode, engine, presets, pick, renderDraft } from './live.js';
import { PREVIEW_CSS } from './chrome.js';

const T = UI.ed;
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
const fmtMs = (ms) => (ms < 10 ? ms.toFixed(1) : String(Math.round(ms)));
const toast = (text) => dispatchEvent(new CustomEvent('site:toast', { detail: text }));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === undefined || v === null) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter(Boolean));
  return node;
}

const page = $('#ed');
const startSelect = $('#ed-from');
const fileInput = $('#ed-file');
const banner = $('#ed-banner');
const form = $('#ed-form');
const view = $('#ed-view');
const box = $('.tview-box', view);
const frame = $('iframe', box);
const status = $('.tview-status', view);
const problemsBox = $('#ed-problems');
const submitBtn = $('#ed-submit');
const submitState = $('#ed-submit-state');
const downloadBtn = $('#ed-download');

const state = {
  M: null,
  index: null,
  name: '',
  data: {},
  text: '',
  jsonError: false,
  problems: [],
  existing: [],
  dirty: false,
  mode: 'light',
  sample: 'tcp',
  run: 0,
  from: '',
};

// ── The page: the form controls, found by path ──
const controls = new Map(); // key → { input, color?, error? }
let jsonBox;
let jsonErrors;
let nameInput;

const key = (path) => path.join('.');

function field({ id, label, path, kind = 'input', options, hint, area }) {
  const k = key(path);
  const errId = `ed-err-${id}`;
  const input = kind === 'select'
    ? el('select', { id: `ed-${id}`, class: 'ed-input' }, options.map(([value, text]) => el('option', { value, text })))
    : area ? el('textarea', { id: `ed-${id}`, class: 'ed-input ed-area', rows: '3' }) : el('input', { id: `ed-${id}`, class: 'ed-input', type: 'text', spellcheck: 'false' });
  const error = el('p', { class: 'ed-err', id: errId });
  input.setAttribute('aria-describedby', errId);
  controls.set(k, { input, error });
  return el('div', { class: 'ed-field' }, el('label', { for: `ed-${id}`, text: label }), input, hint && el('p', { class: 'fine ed-hint', text: hint }), error);
}

function tokenRow(mode, token) {
  const id = `${mode}-${token.slice(2)}`;
  const text = el('input', { id: `ed-${id}`, class: 'ed-input ed-tok-text mono', type: 'text', spellcheck: 'false' });
  const color = el('input', { type: 'color', class: 'ed-color', 'aria-label': fill(T.picker, { token, mode: T[mode] }) });
  controls.set(`tokens.${mode}.${token}`, { input: text, color });
  const write = (value) => edit(['tokens', mode, token], value);
  text.addEventListener('input', () => write(text.value.trim()));
  color.addEventListener('input', () => {
    text.value = color.value;
    write(color.value);
  });
  return el('div', { class: 'ed-tok' }, el('label', { for: `ed-${id}`, class: 'ed-tok-name mono', text: token }), color, text);
}

function layoutRow(token) {
  const id = `common-${token.slice(2)}`;
  const text = el('input', { id: `ed-${id}`, class: 'ed-input mono', type: 'text', spellcheck: 'false' });
  controls.set(`tokens.common.${token}`, { input: text });
  text.addEventListener('input', () => edit(['tokens', 'common', token], text.value.trim()));
  return el('div', { class: 'ed-field' }, el('label', { for: `ed-${id}`, class: 'mono', text: token }), text);
}

function buildForm() {
  const { M } = state;
  nameInput = el('input', { id: 'ed-name', class: 'ed-input mono', type: 'text', spellcheck: 'false', autocapitalize: 'off', placeholder: 'my-theme', maxlength: '80' });
  const nameError = el('p', { class: 'ed-err', id: 'ed-err-name' });
  nameInput.setAttribute('aria-describedby', 'ed-err-name');
  controls.set('name', { input: nameInput, error: nameError });
  nameInput.addEventListener('input', () => {
    state.name = nameInput.value.trim();
    state.dirty = true;
    update();
  });

  const text = (id, label, path, extra = {}) => field({ id, label, path, ...extra });
  const sections = [
    el('fieldset', { class: 'ed-sec' },
      el('legend', { class: 'minor', text: T.s_identity }),
      el('div', { class: 'ed-field' }, el('label', { for: 'ed-name', text: T.name }), nameInput, el('p', { class: 'fine ed-hint', text: T.name_hint }), nameError),
      el('div', { class: 'ed-pair' }, text('label-en', `${T.label} (en)`, ['label', 'en']), text('label-zh', `${T.label} (zh)`, ['label', 'zh'])),
      el('div', { class: 'ed-pair' }, text('desc-en', `${T.description} (en)`, ['description', 'en'], { area: true }), text('desc-zh', `${T.description} (zh)`, ['description', 'zh'], { area: true })),
      el('div', { class: 'ed-pair' },
        text('author', T.author, ['author']),
        text('license', T.license, ['license'], { kind: 'select', options: [['MIT', 'MIT'], ['CC0-1.0', 'CC0-1.0']] })),
      text('font', T.font, ['font'], { kind: 'select', options: [['', T.font_none], ['bangers', 'Bangers']], hint: T.font_hint })),
  ];
  for (const mode of ['light', 'dark']) {
    const error = el('p', { class: 'ed-err', id: `ed-err-tokens-${mode}` });
    controls.set(`tokens.${mode}`, { error });
    sections.push(el('fieldset', { class: 'ed-sec' },
      el('legend', { class: 'minor', text: fill(T.colors, { mode: T[mode] }) }),
      error,
      M.COLOR_GROUPS.map((g) => el('div', { class: 'ed-group' }, el('h3', { class: 'ed-group-t', text: T[`g_${g.id}`] }), el('div', { class: 'ed-toks' }, g.tokens.map((t) => tokenRow(mode, t)))))));
  }
  const commonError = el('p', { class: 'ed-err', id: 'ed-err-tokens-common' });
  controls.set('tokens.common', { error: commonError });
  sections.push(el('fieldset', { class: 'ed-sec' },
    el('legend', { class: 'minor', text: T.layout }),
    el('p', { class: 'fine ed-hint', text: T.layout_hint }),
    commonError,
    el('div', { class: 'ed-toks' }, M.LAYOUT_TOKENS.map(layoutRow))));

  jsonBox = el('textarea', { id: 'ed-json', class: 'ed-input ed-json mono', rows: '18', spellcheck: 'false', autocapitalize: 'off', wrap: 'off' });
  jsonErrors = el('div', { class: 'ed-err', id: 'ed-err-json' });
  jsonBox.setAttribute('aria-describedby', 'ed-err-json ed-json-hint');
  jsonBox.addEventListener('input', () => {
    state.dirty = true;
    const parsed = state.M.parseThemeText(jsonBox.value);
    state.jsonError = !parsed.data;
    if (parsed.data) {
      state.data = parsed.data;
      syncForm();
    }
    update({ keepJson: true });
  });
  sections.push(el('fieldset', { class: 'ed-sec' },
    el('legend', { class: 'minor', text: T.json }),
    el('p', { class: 'fine ed-hint', id: 'ed-json-hint', text: T.json_hint }),
    el('label', { for: 'ed-json', class: 'ed-sr', text: T.json }),
    jsonBox,
    jsonErrors));
  form.replaceChildren(...sections);

  for (const [k, c] of controls) {
    const path = k.split('.');
    if (k === 'name' || k.startsWith('tokens.') || !c.input) continue;
    const isSelect = c.input.tagName === 'SELECT';
    c.input.addEventListener(isSelect ? 'change' : 'input', () => edit(path, c.input.value, { drop: k === 'font' && c.input.value === '' }));
  }
}

// ── Data → controls ──
const valueOf = (mode, token) => {
  const tokens = state.data.tokens ?? {};
  const own = tokens[mode]?.[token];
  return typeof own === 'string' ? own : typeof tokens.common?.[token] === 'string' ? tokens.common[token] : '';
};

function ensureOption(select, value) {
  if (value === '' || [...select.options].some((o) => o.value === value)) return;
  select.append(el('option', { value, text: value }));
}

function syncForm() {
  const { M, data } = state;
  nameInput.value = state.name;
  for (const [k, c] of controls) {
    if (!c.input || k === 'name') continue;
    const [group, ...rest] = k.split('.');
    let value;
    if (group === 'tokens') {
      const [mode, token] = [rest[0], rest.slice(1).join('.')];
      value = mode === 'common' ? M.getIn(data, ['tokens', 'common', token]) : valueOf(mode, token);
    } else value = M.getIn(data, k.split('.'));
    const shown = typeof value === 'string' ? value : '';
    if (c.input.tagName === 'SELECT') ensureOption(c.input, shown);
    c.input.value = shown;
    if (c.color) {
      const hex = M.colorHex(shown);
      c.color.value = hex ?? '#000000';
      c.color.disabled = !hex;
    }
  }
}

function writeJson() {
  jsonBox.value = state.M.formatThemeFile(state.data);
  state.jsonError = false;
}

// ── Controls → data ──
function edit(path, value, { drop = value === '' && path[0] === 'tokens' } = {}) {
  state.dirty = true;
  state.data = state.M.setIn(state.data, path, drop ? undefined : value);
  if (path[0] === 'tokens' && path[1] !== 'common') {
    const c = controls.get(`tokens.${path[1]}.${path[2]}`);
    const hex = state.M.colorHex(value);
    if (c?.color) {
      if (hex) c.color.value = hex;
      c.color.disabled = !hex;
    }
  }
  writeJson();
  update({ keepJson: true });
}

// ── The check ──
function update({ keepJson = false } = {}) {
  const { M } = state;
  const { text, problems } = M.checkTheme({ name: state.name, data: state.data, rawText: jsonBox.value, jsonError: state.jsonError, existing: state.existing });
  state.text = text;
  state.problems = problems;
  if (!keepJson && !state.jsonError) writeJson();
  showProblems();
  schedulePreview();
}

function showProblems() {
  const { M, problems } = state;
  const byField = M.problemsByField(problems);
  // The list: every problem, with the field it belongs to.
  if (!problems.length) {
    problemsBox.replaceChildren(el('p', { class: 'ed-ok', text: T.ok }));
  } else {
    problemsBox.replaceChildren(
      el('p', { class: 'ed-count', text: problems.length === 1 ? T.one : fill(T.many, { n: problems.length }) }),
      el('ul', { class: 'ed-list' }, problems.map((p) => el('li', {}, el('code', { text: p.field }), ' ', p.message))));
  }
  // Next to the field: a message under a control of the form. A problem for a field the form has no control for goes under the JSON view.
  const other = problems.filter((p) => !M.FORM_FIELDS.includes(p.field));
  for (const [k, c] of controls) {
    if (!c.error) continue;
    const messages = byField.get(k) ?? [];
    c.error.replaceChildren(...messages.map((m) => el('span', { text: m })));
    c.error.classList.toggle('is-on', messages.length > 0);
    if (c.input) c.input.setAttribute('aria-invalid', String(messages.length > 0));
  }
  jsonErrors.replaceChildren(...other.map((p) => el('p', {}, el('code', { text: p.field }), ' ', p.message)));
  jsonErrors.classList.toggle('is-on', other.length > 0);
  jsonBox.setAttribute('aria-invalid', String(other.length > 0));
  // Color and layout inputs a message names are marked too.
  for (const [k, c] of controls) {
    const [group, mode, ...rest] = k.split('.');
    if (group !== 'tokens' || !rest.length) continue;
    const named = (byField.get(`tokens.${mode}`) ?? []).some((m) => M.tokensNamed(m).includes(rest.join('.')));
    c.input.setAttribute('aria-invalid', String(named));
  }
  submitBtn.disabled = problems.length > 0;
  submitState.textContent = problems.length ? fill(problems.length === 1 ? T.submit_blocked_one : T.submit_blocked, { n: problems.length }) : '';
}

// ── The preview ──
function fit() {
  let doc;
  try { doc = frame.contentDocument; } catch { return; }
  if (!doc?.body) return;
  const h = Math.ceil(doc.documentElement.getBoundingClientRect().height);
  if (h < 100) return;
  frame.style.height = `${h}px`;
  box.style.aspectRatio = `${frame.offsetWidth} / ${h}`;
}
function settle() {
  let doc;
  try { doc = frame.contentDocument; } catch { return; }
  if (!doc?.getElementById('am-source')) return;
  if (!doc.getElementById('site-frame-css')) {
    doc.head.append(Object.assign(doc.createElement('style'), { id: 'site-frame-css', textContent: PREVIEW_CSS }));
  }
  doc.documentElement.setAttribute('data-mode', state.mode);
  fit();
}
frame.addEventListener('load', settle);
if ('ResizeObserver' in window) new ResizeObserver(fit).observe(box);

let timer = 0;
function schedulePreview() {
  clearTimeout(timer);
  timer = setTimeout(renderPreview, 250);
}

async function renderPreview() {
  const run = ++state.run;
  const { M } = state;
  const { theme, errors } = M.previewTheme(state.data);
  if (state.jsonError || errors.length) {
    status.textContent = T.paused;
    return;
  }
  view.setAttribute('aria-busy', 'true');
  try {
    const res = await renderDraft(pick(await presets(), state.sample), { theme: 'preview', mode: state.mode }, { extra: [theme] });
    if (run !== state.run) return;
    if (!res.ok) throw new Error(res.error.message);
    frame.srcdoc = res.html;
    frame.title = fill(view.dataset.frameTitle, { sample: $(`[data-group="sample"] [aria-checked="true"]`, view).textContent });
    status.textContent = fill(UI.liveMs, { ms: fmtMs(res.ms) });
  } catch (err) {
    if (run !== state.run) return;
    console.error('theme preview failed', err);
    status.textContent = UI.catFailed;
  } finally {
    if (run === state.run) view.removeAttribute('aria-busy');
  }
}

// The two switches, as on a theme page: sample and mode.
function radio(group, onChoose) {
  const buttons = $$('[role="radio"]', $(`[data-group="${group}"]`, view));
  const mark = (value) => {
    for (const b of buttons) {
      const on = b.dataset.v === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  const choose = (button) => {
    if (button.getAttribute('aria-checked') === 'true') return;
    mark(button.dataset.v);
    onChoose(button.dataset.v);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => choose(b));
    b.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = buttons[(i + step + buttons.length) % buttons.length];
      next.focus();
      choose(next);
    });
  });
  return mark;
}
function setMode(mode) {
  state.mode = mode;
  markMode(mode);
  try { frame.contentDocument?.documentElement.setAttribute('data-mode', mode); } catch { /* another origin */ }
}
const markMode = radio('mode', (mode) => {
  track('theme-mode', { theme: 'editor', mode });
  setMode(mode);
});
radio('sample', (sample) => {
  track('theme-sample', { theme: 'editor', sample });
  state.sample = sample;
  clearTimeout(timer);
  renderPreview();
});
addEventListener('site:mode', (e) => setMode(e.detail));

// ── Loading a theme into the editor ──
function say(text, kind = 'info', link) {
  banner.replaceChildren(text, ...(link ? [' ', el('a', { href: link.href, target: '_blank', rel: 'noopener', text: link.text })] : []));
  banner.className = `ed-banner is-${kind}`;
  banner.hidden = !text;
}

function load({ name = '', data = {}, rawText = null }) {
  state.name = name;
  state.dirty = false;
  if (rawText !== null) {
    const parsed = state.M.parseThemeText(rawText);
    state.jsonError = !parsed.data;
    if (parsed.data) state.data = parsed.data;
    else state.data = {};
    jsonBox.value = parsed.data ? state.M.formatThemeFile(parsed.data) : rawText;
  } else {
    state.data = data;
    state.jsonError = false;
    jsonBox.value = state.M.formatThemeFile(data);
  }
  syncForm();
  update({ keepJson: true });
}

// Pick the "custom" entry of the start list (a file or an issue), which only exists once something was loaded that way.
function markCustom(text) {
  let option = $('option[value="__custom"]', startSelect);
  if (!option) {
    option = el('option', { value: '__custom' });
    startSelect.prepend(option);
  }
  option.textContent = text;
  startSelect.value = '__custom';
  state.from = '__custom';
}

async function startFromChoice(value) {
  const { M, index } = state;
  const choice = M.startChoices(index, UI.lang).find((c) => c.value === value);
  if (!choice) return false;
  let file;
  if (choice.kind === 'builtin') file = M.builtinThemeFile(value);
  else {
    const res = await fetch(`${BASE}themes/${value}.json`);
    if (!res.ok) throw new Error(`themes/${value}.json: HTTP ${res.status}`);
    file = await res.json();
  }
  load({ name: '', data: M.startFrom(file) });
  $('option[value="__custom"]', startSelect)?.remove();
  startSelect.value = value;
  state.from = value;
  return true;
}

startSelect.addEventListener('change', async () => {
  const value = startSelect.value;
  if (state.dirty && !confirm(T.confirm_switch)) {
    startSelect.value = state.from;
    return;
  }
  track('editor-start', { from: value, kind: state.M.startChoices(state.index).find((c) => c.value === value)?.kind ?? 'other' });
  try {
    await startFromChoice(value);
    say('');
  } catch (err) {
    console.error('start failed', err);
    startSelect.value = state.from;
    say(fill(T.start_failed, { name: value }), 'err');
  }
});

// ── A file: the picker, a drop, or the JSON view for paste ──
async function loadFile(file) {
  if (!file) return;
  const { M } = state;
  if (file.size > M.MAX_READ) {
    say(fill(T.file_big, { kb: Math.round(M.MAX_READ / 1024) }), 'err');
    return;
  }
  const text = await file.text();
  const parsed = M.parseThemeText(text);
  if (!parsed.data) {
    say(fill(T.file_bad, { file: file.name, why: parsed.error }), 'err');
    return;
  }
  if (state.dirty && !confirm(T.confirm_switch)) return;
  track('editor-upload');
  const guess = M.nameFromFile(file.name);
  load({ name: M.isFreeName(guess, state.existing) ? guess : '', data: parsed.data });
  markCustom(fill(T.from_file, { file: file.name }));
  say(fill(T.file_ok, { file: file.name }), 'ok');
}

$('#ed-file-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  await loadFile(fileInput.files[0]);
  fileInput.value = '';
});
let dragDepth = 0;
const hasFile = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
page.addEventListener('dragenter', (e) => {
  if (!hasFile(e)) return;
  dragDepth++;
  page.classList.add('is-drag');
});
page.addEventListener('dragover', (e) => {
  if (hasFile(e)) e.preventDefault();
});
page.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) page.classList.remove('is-drag');
});
page.addEventListener('drop', async (e) => {
  if (!hasFile(e)) return;
  e.preventDefault();
  dragDepth = 0;
  page.classList.remove('is-drag');
  await loadFile(e.dataTransfer.files[0]);
});

// ── Download and submit ──
downloadBtn.addEventListener('click', () => {
  track('editor-download');
  const name = `${state.name || 'theme'}.json`;
  const url = URL.createObjectURL(new Blob([state.text], { type: 'application/json' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(fill(UI.downloaded, { name }));
});

submitBtn.addEventListener('click', async () => {
  if (state.problems.length) return;
  const plan = state.M.submitPlan(state.name, state.data);
  track('editor-submit', { mode: plan.paste ? 'paste' : 'link' });
  // The clipboard write and the new tab both need this click, so both start before anything is awaited.
  const copied = plan.paste ? copyText(plan.text) : null;
  window.open(plan.url, '_blank', 'noopener');
  if (!plan.paste) {
    submitState.textContent = T.opened;
    return;
  }
  const ok = await copied;
  submitState.textContent = ok ? T.paste_copied : T.paste_failed;
  toast(ok ? UI.copied : UI.copyFailed);
});

// ── ?issue=<n> ──
async function loadIssue(number) {
  say(fill(T.issue_loading, { n: number }), 'info');
  const result = await state.M.fetchIssue(number);
  const link = { href: `https://github.com/${state.M.REPO}/issues/${number}`, text: fill(T.issue_open, { n: number }) };
  if (!result.ok) {
    const message = {
      rate: T.issue_rate,
      missing: T.issue_missing,
      empty: T.issue_empty,
      network: T.issue_network,
      http: fill(T.issue_http, { status: result.status ?? '' }),
    }[result.reason];
    say(fill(message, { n: number }), 'err', link);
    return false;
  }
  load({ name: result.name, data: {}, rawText: result.text });
  markCustom(fill(T.from_issue, { n: number }));
  say(fill(T.issue_ok, { n: number, title: result.title }), 'ok', link);
  return true;
}

// ── Start ──
async function main() {
  view.setAttribute('aria-busy', 'true');
  status.textContent = UI.loading;
  let M;
  let index;
  try {
    [M, index] = await Promise.all([engine(), fetch(`${BASE}themes/index.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`themes/index.json: HTTP ${r.status}`))))]);
  } catch (err) {
    console.error('editor could not start', err);
    say(UI.engineFailed, 'err');
    status.textContent = UI.catFailed;
    view.removeAttribute('aria-busy');
    return;
  }
  state.M = M;
  state.index = index;
  state.existing = index.themes.map((t) => t.name);
  buildForm();
  const choices = M.startChoices(index, UI.lang);
  const group = (kind, label) => el('optgroup', { label }, choices.filter((c) => c.kind === kind).map((c) => el('option', { value: c.value, text: `${c.label} (${c.value})` })));
  startSelect.replaceChildren(group('builtin', T.group_builtin), group('catalog', T.group_catalog));
  startSelect.disabled = false;
  setMode(siteMode());

  const params = new URLSearchParams(location.search);
  const issue = M.issueNumber(location.search);
  const wanted = params.get('from');
  const known = choices.some((c) => c.value === wanted);
  const first = known ? wanted : 'blueprint';
  try {
    await startFromChoice(first);
    if (known) track('editor-start', { from: first, kind: choices.find((c) => c.value === first).kind, via: 'link' });
  } catch (err) {
    console.error('start failed', err);
    say(fill(T.start_failed, { name: first }), 'err');
  }
  if (wanted && !known) say(fill(T.from_unknown, { name: wanted.slice(0, 40) }), 'info');
  if (params.has('issue') && issue === null) say(T.issue_bad, 'err');
  if (issue !== null) {
    track('editor-issue');
    await loadIssue(issue);
  }
  view.removeAttribute('aria-busy');
}

main();
