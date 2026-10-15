// Version strings in x.y.z format. No Node imports, so the browser engine (check.js reads them for a theme's `requires`) can bundle it.
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(v) {
  const m = String(v).trim().match(SEMVER);
  return m ? m.slice(1, 4).map(Number) : null;
}

// Whether a is newer than b. Returns false when either is not in x.y.z format.
export function newer(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return false;
  const i = pa.findIndex((n, k) => n !== pb[k]);
  return i !== -1 && pa[i] > pb[i];
}
