// The Content-Security-Policy every page carries as a <meta> tag. A raw html / svg fence reaches the page unchanged, so without a policy an
// injected <script> or onerror= would run when the page opens, and an <img src="https://…"> or css url(https://…) would send data out
// with no script at all. The policy allows only the page's own inline scripts, each pinned by the hash of its exact text, and no remote
// content: images, fonts and media are data: URIs, which is how the page embeds them. Inline style stays allowed (the themes and
// the diagrams set style attributes).

import { sha256Base64 } from './sha256.js';
import { LIVE_JS } from './assets.js';

// The text between <script data-live> and </script> that `am serve` adds (src/serve.js). The page cannot know whether it will be
// served, and a meta policy applies on top of the server's headers, so every page pins this exact text. One constant for both sides
// keeps the hash from drifting from what the server sends.
export const LIVE_SCRIPT_BODY = `\n${LIVE_JS}`;

// CSP source expression for a script's text: base64 of the SHA-256 of its UTF-8 bytes (src/sha256.js, so the site's browser bundle can render pages too).
export const scriptHash = (text) => `'sha256-${sha256Base64(text)}'`;

// The page with one more inline script allowed, for a caller that adds a script of its own to a rendered page (the site's preview frames).
export const pinScript = (html, text) => html.replace(/(<meta http-equiv="Content-Security-Policy" content="[^"]*?script-src )/, `$1${scriptHash(text)} `);

// `scripts`: the exact text of each executable inline <script> in the page. connect-src 'self' is for the live-reload EventSource.
export function cspMeta(scripts, { live = false } = {}) {
  const hashes = [...scripts, ...(live ? [LIVE_SCRIPT_BODY] : [])].map(scriptHash);
  const policy = [
    "default-src 'none'",
    `script-src ${hashes.join(' ')}`,
    "style-src 'unsafe-inline'",
    'img-src data:',
    'font-src data:',
    'media-src data:',
    "connect-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}
