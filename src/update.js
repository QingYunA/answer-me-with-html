// New-version notice: once a week a background child process reads package.json on GitHub and writes the result into state.json;
// on the next render, if a new version exists, print one "! Update hint" line for the Agent, which asks the user, and put a
// new-version button on the page. Never updates automatically.
import { spawn } from 'node:child_process';
import { DAY, writeState } from './state.js';

export const UPDATE = Object.freeze({
  checkEveryDays: 7,
  hintEveryDays: 3,
  timeoutMs: 5000,
  url: 'https://raw.githubusercontent.com/QingYunA/answer-me-with-html/main/package.json',
});

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

// The update command for each install method, as the user types it.
export const UPDATE_COMMANDS = Object.freeze({
  plugin: 'claude plugin update answer-me-with-html@answer-me-with-html',
  repo: 'git pull && npm install',
  skills: 'npx skills update answer-me-with-html -y',
});

// How this copy was installed. scriptPath is the path of the running am script.
export function installMethod(scriptPath = '') {
  if (/[\\/]\.claude[\\/]plugins[\\/]/.test(scriptPath)) return 'plugin';
  if (/[\\/]bin[\\/]am\.js$/.test(scriptPath)) return 'repo';
  return 'skills';
}

// Give the update command for the install method, as an instruction for the Agent.
export function updateCommand(scriptPath = '') {
  const method = installMethod(scriptPath);
  if (method === 'plugin') {
    return `run ${UPDATE_COMMANDS.plugin} in a terminal (or click Update now on the Installed tab of /plugin), then /reload-plugins`;
  }
  if (method === 'repo') return `run ${UPDATE_COMMANDS.repo} in the answer-me-with-html repository`;
  return `run ${UPDATE_COMMANDS.skills}`;
}

// update_check off, CI and AM_NO_UPDATE_CHECK each turn off both the background check and the update notice.
export const updateEnabled = (env, config) => !(config.update_check === false || env.CI || env.AM_NO_UPDATE_CHECK);

export function updateHint(state, current, scriptPath, now = Date.now()) {
  if (!newer(state.latestVersion, current)) return null;
  if (state.lastUpdateHint && now - state.lastUpdateHint < UPDATE.hintEveryDays * DAY) return null;
  return `! Update hint: Answer me with HTML ${state.latestVersion} is available (current ${current}). Ask the user whether to update: ${updateCommand(scriptPath)}.`;
}

// The new-version button on the page: { latest, current, command } when a newer version is known, else null. Unlike updateHint it
// is not throttled: the button is quiet until the user clicks it, so every page made while this copy is out of date carries it.
export function pageUpdate(state, current, scriptPath, env, config) {
  if (!updateEnabled(env, config) || !newer(state.latestVersion, current)) return null;
  return { latest: state.latestVersion, current, command: UPDATE_COMMANDS[installMethod(scriptPath)] };
}

export function shouldCheckUpdate(state, env, config, now = Date.now()) {
  if (!updateEnabled(env, config)) return false;
  return !state.lastUpdateCheck || now - state.lastUpdateCheck >= UPDATE.checkEveryDays * DAY;
}

export function spawnUpdateCheck(home, scriptPath) {
  writeState(home, { lastUpdateCheck: Date.now() });
  try {
    spawn(process.execPath, [scriptPath, '__update-check'], { detached: true, stdio: 'ignore', env: { ...process.env, AM_HOME: home } })
      .on('error', () => {})
      .unref();
  } catch {
    // A failed background check does not affect normal use.
  }
}

// Accept only x.y.z version numbers and ignore anything else, so arbitrary remote text never reaches the Agent's context.
export async function runUpdateCheck(home, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(UPDATE.url, { signal: AbortSignal.timeout(UPDATE.timeoutMs) });
    if (!res.ok) return null;
    const { version } = await res.json();
    if (!parseVersion(version)) return null;
    writeState(home, { latestVersion: version.trim(), lastUpdateCheck: Date.now() });
    return version.trim();
  } catch {
    return null;
  }
}
