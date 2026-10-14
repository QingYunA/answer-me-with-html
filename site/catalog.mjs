// The theme catalog on the website: marketplace/themes/<name>.json is published unchanged as /themes/<name>.json,
// /themes/index.json lists every theme, and /themes/ (and /zh/themes/) shows a card for each one.
// Build time only (site/build.mjs). The live previews are drawn in the browser by site/src/catalog.js.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeTheme } from '../src/themes/check.js';
import { BUILTIN_NAMES } from '../src/themes/registry.js';
import { escapeHtml } from './i18n/_draft.js';

const esc = escapeHtml;
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// The font names the cards show; the key is the `font` field of a theme file.
const FONT_LABELS = { bangers: 'Bangers' };

// Every theme of the catalog, sorted by name: { name, file, bytes, sha256, data }.
// A file that is not a usable theme stops the build, so the website never publishes one (test/marketplace.test.js checks the same rules).
export function readCatalog(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => {
    const name = file.replace(/\.json$/, '');
    if (name === 'index') throw new Error('marketplace/themes/index.json would replace the catalog list (themes/index.json); rename the theme');
    const bytes = readFileSync(join(dir, file));
    const data = JSON.parse(bytes.toString('utf8'));
    const { errors } = normalizeTheme(name, data, BUILTIN_NAMES);
    if (errors.length) throw new Error(`marketplace/themes/${file}: ${errors.join('; ')}`);
    for (const key of ['version', 'author', 'license']) {
      if (typeof data[key] !== 'string' || !data[key]) throw new Error(`marketplace/themes/${file}: "${key}" is missing`);
    }
    if (typeof data.description?.en !== 'string') throw new Error(`marketplace/themes/${file}: "description.en" is missing`);
    return { name, file, bytes, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), data };
  });
}

// The text of /themes/index.json. No dates and no unsorted keys, so a rebuild from the same files gives the same bytes.
export function catalogIndex(entries, siteUrl) {
  const themes = entries.map(({ name, data, size, sha256 }) => ({
    name,
    version: data.version,
    label: data.label,
    description: data.description,
    author: data.author,
    license: data.license,
    ...(data.font && { font: data.font }),
    ...(data.requires && { requires: data.requires }),
    size,
    sha256,
    url: `${siteUrl}themes/${name}.json`,
  }));
  return `${JSON.stringify({ schema: 1, themes }, null, 2)}\n`;
}

// The install commands of one theme: `am theme add` (0.6.0 and newer), an agent prompt that names it and the manual save for older versions.
export function installTexts(name, siteUrl, dict) {
  const url = `${siteUrl}themes/${name}.json`;
  return {
    command: `am theme add ${name} --use`,
    agent: fill(dict.c_agent_prompt, { name, url }),
    unix: `curl -fsSL ${url} -o ~/.answer-me-with-html/themes/${name}.json --create-dirs`,
    windows: `New-Item -ItemType Directory -Force "$HOME\\.answer-me-with-html\\themes" | Out-Null\nInvoke-WebRequest ${url} -OutFile "$HOME\\.answer-me-with-html\\themes\\${name}.json"`,
  };
}

// One card: the title and facts, the live preview (filled in by catalog.js) and the install block.
function card(entry, dict, lang, siteUrl) {
  const { name, data, size } = entry;
  const label = data.label[lang] ?? data.label.en;
  const description = data.description[lang] ?? data.description.en;
  const install = installTexts(name, siteUrl, dict);
  const font = data.font ? FONT_LABELS[data.font] ?? data.font : '';
  const facts = [
    [dict.c_version, `<span class="mono">${esc(data.version)}</span>`],
    [dict.c_author, esc(data.author)],
    [dict.c_license, esc(data.license)],
    [dict.c_size, `<span class="mono">${(size / 1024).toFixed(1)} KB</span>`],
    ...(font ? [[dict.c_font, esc(font)]] : []),
  ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('\n          ');
  // One tab and one panel for each way to install. Without JavaScript every panel shows, each under its own label.
  const ways = [['command', dict.c_cmd], ['agent', dict.c_ask], ['curl', dict.c_unix], ['powershell', dict.c_windows]];
  const tabs = ways.map(([method, label], i) => `<button type="button" role="tab" id="${name}-t-${method}" aria-controls="${name}-p-${method}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-method="${method}" data-copy-label="${esc(fill(dict.c_copy_aria, { what: label, name }))}">${esc(label)}</button>`).join('\n          ');
  const text = { command: install.command, agent: install.agent, curl: install.unix, powershell: install.windows };
  const panels = ways.map(([method, label]) => `<div class="tpanel tpanel--${method}" role="tabpanel" id="${name}-p-${method}" aria-labelledby="${name}-t-${method}"><p class="tcard-step">${esc(label)}</p><pre>${esc(text[method])}</pre></div>`).join('\n          ');
  const note = fill(data.font ? dict.c_note_font : dict.c_note, { font });
  return `<article class="tcard" id="${name}" data-theme="${name}" data-file="${esc(`themes/${name}.json`)}" aria-labelledby="${name}-title">
    <header class="tcard-head">
      <h2 id="${name}-title">${esc(label)}</h2>
      <code class="tcard-name">${name}</code>
    </header>
    <p class="tcard-desc">${esc(description)}</p>
    <div class="tcard-body">
      <div class="tcard-view">
        <div class="tcard-bar">
          <div class="seg-tabs" role="radiogroup" aria-label="${esc(dict.c_mode_label)}">
            <button type="button" role="radio" aria-checked="true" data-v="light">${esc(dict.pg_mode_light)}</button>
            <button type="button" role="radio" aria-checked="false" data-v="dark">${esc(dict.pg_mode_dark)}</button>
          </div>
          <span class="tcard-ms mono" aria-live="polite"></span>
        </div>
        <div class="tcard-box" data-frame-title="${esc(fill(dict.c_frame_title, { label }))}">
          <span class="tcard-wait mono">${esc(dict.c_rendering)}</span>
          <noscript><span class="tcard-wait mono">${esc(dict.c_nojs)}</span></noscript>
        </div>
      </div>
      <div class="tcard-install">
        <h3 class="minor">${esc(dict.c_install)}</h3>
        <div class="seg-tabs tcard-tabs" role="tablist" aria-label="${esc(dict.c_install_tabs)}">
          ${tabs}
        </div>
        <div class="copybox">
          ${panels}
          <button type="button" class="tcopy-btn" data-done="${esc(dict.copied)}">${esc(dict.copy)}</button>
        </div>
        <p class="fine">${esc(note)}</p>
        <dl class="tcard-facts mono">
          ${facts}
        </dl>
      </div>
    </div>
  </article>`;
}

export const cardsHtml = (entries, dict, lang, siteUrl) => entries.map((e) => card(e, dict, lang, siteUrl)).join('\n  ');
