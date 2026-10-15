// SHA-256 of a string's UTF-8 bytes, as base64 (what a CSP script hash is). Plain JavaScript on purpose: the site bundles the render
// path for the browser (site/build.mjs), where node:crypto does not exist and WebCrypto is async. test/csp.test.js checks it against
// node:crypto.

const K = Uint32Array.from({ length: 64 }, (_, i) => {
  // The first 32 bits of the fractional part of the cube root of the i-th prime.
  let n = 2;
  for (let seen = 0; ; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) prime = false;
    if (prime && seen++ === i) break;
  }
  return Math.floor((Math.cbrt(n) % 1) * 2 ** 32);
});

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256Base64(text) {
  const data = new TextEncoder().encode(text);
  const blocks = Math.ceil((data.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((data.length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0);

  // The first 32 bits of the fractional part of the square root of the first eight primes.
  const h = Uint32Array.from([2, 3, 5, 7, 11, 13, 17, 19], (p) => Math.floor((Math.sqrt(p) % 1) * 2 ** 32));
  const w = new Uint32Array(64);
  for (let at = 0; at < padded.length; at += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(at + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) >>> 0; });
  }
  const out = new Uint8Array(32);
  h.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
  return btoa(String.fromCharCode(...out));
}
