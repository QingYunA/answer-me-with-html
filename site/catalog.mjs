// The theme catalog on the website: marketplace/themes/<name>.json is published unchanged as /themes/<name>.json,
// /themes/index.json lists every theme, /themes/ (and /zh/themes/) is a wall with a card for each one, and every theme has its own page,
// /themes/<name>/ (and /zh/themes/<name>/). Build time only (site/build.mjs); site/src/catalog.js and site/src/theme.js make the pages interactive.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogProblems } from '../src/themes/catalog-rules.js';
import { escapeHtml } from './i18n/_draft.js';

const esc = escapeHtml;
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// The font names the cards show; the key is the `font` field of a theme file.
const FONT_LABELS = { bangers: 'Bangers' };

// Every theme of the catalog, sorted by name: { name, file, bytes, sha256, data }.
// A file that breaks a catalog rule stops the build, so the website never publishes one (test/marketplace.test.js checks the same rules).
export function readCatalog(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => {
    const name = file.replace(/\.json$/, '');
    const bytes = readFileSync(join(dir, file));
    const problems = catalogProblems(name, bytes.toString('utf8'));
    if (problems.length) throw new Error(`marketplace/themes/${file}: ${problems.map((p) => p.message).join(' ')}`);
    return { name, file, bytes, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), data: JSON.parse(bytes.toString('utf8')) };
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

// The install commands of one theme: `am theme add` (0.5.3 and newer), an agent prompt that names it and the manual save for older versions.
function installTexts(name, siteUrl, dict) {
  const url = `${siteUrl}themes/${name}.json`;
  return {
    command: `am theme add ${name} --use`,
    agent: fill(dict.th_agent_prompt, { name, url }),
    unix: `curl -fsSL ${url} -o ~/.answer-me-with-html/themes/${name}.json --create-dirs`,
    windows: `New-Item -ItemType Directory -Force "$HOME\\.answer-me-with-html\\themes" | Out-Null\nInvoke-WebRequest ${url} -OutFile "$HOME\\.answer-me-with-html\\themes\\${name}.json"`,
  };
}

const labelOf = (data, lang) => data.label[lang] ?? data.label.en;
const descriptionOf = (data, lang) => data.description[lang] ?? data.description.en;
const fontOf = (data) => (data.font ? FONT_LABELS[data.font] ?? data.font : '');

// One card of the wall: the pre-rendered sample page in a small frame, and the name, description and tags.
// The title is the card's link; its ::after covers the whole card (an <a> may not contain a frame). The frame is for looking only.
// Paths are relative: the wall and the theme's folder (<name>/) sit in the same directory in both languages.
function wallCard(entry, dict, lang) {
  const { name, data } = entry;
  const label = labelOf(data, lang);
  const font = fontOf(data);
  const tags = [...(font ? [`${dict.th_font}: ${font}`] : []), ...(data.requires ? [`${dict.th_requires} ${data.requires}+`] : [])];
  const tagList = tags.length ? `\n        <ul class="ttags mono">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  return `<li class="twall-item">
    <article class="tcard" data-theme="${name}">
      <div class="tthumb"><iframe src="${name}/preview.html" title="${esc(label)}" loading="lazy" tabindex="-1" aria-hidden="true" scrolling="no"></iframe></div>
      <div class="tcard-text">
        <h2 class="tcard-title"><a class="tcard-link" href="${name}/">${esc(label)}</a></h2>
        <code class="tcard-name">${name}</code>
        <p class="tcard-desc">${esc(descriptionOf(data, lang))}</p>${tagList}
      </div>
    </article>
  </li>`;
}

export const wallHtml = (entries, dict, lang) => `<ul class="twall">\n  ${entries.map((e) => wallCard(e, dict, lang)).join('\n  ')}\n  </ul>`;

// What site/template-theme.html needs for one theme and language, as values for {{KEY}}: all of it is escaped for HTML already.
export function detailValues(entry, dict, lang, siteUrl) {
  const { name, data, size } = entry;
  const label = labelOf(data, lang);
  const description = descriptionOf(data, lang);
  const font = fontOf(data);
  const install = installTexts(name, siteUrl, dict);
  const facts = [
    [dict.th_version, `<span class="mono">${esc(data.version)}</span>`],
    [dict.th_author, esc(data.author)],
    [dict.th_license, esc(data.license)],
    [dict.th_size, `<span class="mono">${(size / 1024).toFixed(1)} KB</span>`],
    ...(font ? [[dict.th_font, esc(font)]] : []),
    ...(data.requires ? [[dict.th_requires, `<span class="mono">${esc(data.requires)}+</span>`]] : []),
  ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('\n      ');
  const copyAria = (what) => esc(fill(dict.th_copy_aria, { what, name }));
  return {
    THEME_NAME: name,
    THEME_FILE: `themes/${name}.json`,
    THEME_LABEL: esc(label),
    THEME_DESC: esc(description),
    THEME_FACTS: facts,
    META_TITLE: esc(fill(dict.th_page_title, { label })),
    META_DESC: esc(fill(dict.th_page_desc, { desc: description })),
    FRAME_TITLE: esc(fill(dict.th_frame_title, { label, sample: dict.pre_tcp })),
    AGENT_TEXT: esc(install.agent),
    CMD_TEXT: esc(install.command),
    CURL_TEXT: esc(install.unix),
    PS_TEXT: esc(install.windows),
    CMD_ARIA: copyAria(dict.th_cmd),
    CURL_ARIA: copyAria(dict.th_unix),
    PS_ARIA: copyAria(dict.th_windows),
    OLDER_D: fill(dict.th_older_d, { name }),
    NOTE: esc(fill(font ? dict.th_note_font : dict.th_note, { font })),
  };
}
