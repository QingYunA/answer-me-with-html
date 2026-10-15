// New-version notice: once a day a background child process reads package.json on GitHub and writes the result into state.json;
// on the next render, if a new version exists, print one "! Update hint" line for the Agent, which asks the user, and put a
// new-version button on the page. Never updates automatically.
import { spawn } from 'node:child_process';
import { DAY, writeState } from './state.js';
import { parseVersion, newer } from './version.js';

export const UPDATE = Object.freeze({
  checkEveryDays: 1,
  hintEveryDays: 3,
  timeoutMs: 5000,
  url: 'https://raw.githubusercontent.com/QingYunA/answer-me-with-html/main/package.json',
  highlightsUrl: 'https://raw.githubusercontent.com/QingYunA/answer-me-with-html/main/highlights.json',
});

// highlights.json: { "version": "x.y.z", "<language id>": ["line", ...], ... }, written in the release PR (CONTRIBUTING.md).
export const HIGHLIGHTS = Object.freeze({ lines: 3, chars: 80 });
const LANGUAGE_ID = /^[a-z]{2,3}(-[A-Za-z]{2,8})*$/;

// The highlight lists of highlights.json when it describes `version`: { <language id>: [line, ...] }, or null. Only plain one-line
// text within the limits is kept; the page escapes it and the CLI never prints it, so remote text stays out of the Agent's context.
export function parseHighlights(data, version) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== version) return null;
  const lists = Object.entries(data).flatMap(([id, lines]) => {
    if (!LANGUAGE_ID.test(id) || !Array.isArray(lines)) return [];
    const kept = lines
      .filter((l) => typeof l === 'string' && l.trim() && l.length <= HIGHLIGHTS.chars && !/[\u0000-\u001f\u007f]/.test(l))
      .slice(0, HIGHLIGHTS.lines)
      .map((l) => l.trim());
    return kept.length ? [[id, kept]] : [];
  });
  return lists.length ? Object.fromEntries(lists) : null;
}

export { parseVersion, newer };

// The update command for each install method, as the user types it. dsh needs the
// profile and the package name, so it is filled in by dshUpdateCommand.
export const UPDATE_COMMANDS = Object.freeze({
  plugin: 'claude plugin update answer-me-with-html@answer-me-with-html',
  repo: 'git pull && npm install',
  skills: 'npx skills update answer-me-with-html -y',
  dsh: 'dsh plugin --profile <profile> up <package>',
});

// How this copy was installed. scriptPath is the path of the running am script.
export function installMethod(scriptPath = '') {
  if (/[\\/]\.claude[\\/]plugins[\\/]/.test(scriptPath)) return 'plugin';
  if (/[\\/]bin[\\/]am\.js$/.test(scriptPath)) return 'repo';
  if (/[\\/]\.dsh[\\/]profiles[\\/][^\\/]+[\\/]node_modules[\\/]/.test(scriptPath)) return 'dsh';
  return 'skills';
}

// The DSH profile and package name, from ~/.dsh/profiles/<profile>/node_modules/<package>/… — null when
// the path does not parse (a linked copy outside a profile, or a layout that changed).
const DSH_PATH = /[\\/]\.dsh[\\/]profiles[\\/]([^\\/]+)[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/;
// Only plain names go into a command the agent runs or the user pastes; anything else stays a placeholder.
const PROFILE_NAME = /^[\w.-]+$/;
const PACKAGE_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
function dshUpdateCommand(scriptPath = '') {
  const m = scriptPath.match(DSH_PATH);
  if (!m) return UPDATE_COMMANDS.dsh;
  const pkg = m[2].replace(/\\/g, '/');
  return `dsh plugin --profile ${PROFILE_NAME.test(m[1]) ? m[1] : '<profile>'} up ${PACKAGE_NAME.test(pkg) ? pkg : '<package>'}`;
}

// Give the update command for the install method, as an instruction for the Agent.
export function updateCommand(scriptPath = '') {
  const method = installMethod(scriptPath);
  if (method === 'plugin') {
    return `run ${UPDATE_COMMANDS.plugin} in a terminal (or click Update now on the Installed tab of /plugin), then /reload-plugins`;
  }
  if (method === 'repo') return `run ${UPDATE_COMMANDS.repo} in the answer-me-with-html repository`;
  if (method === 'dsh') return `run ${dshUpdateCommand(scriptPath)}`;
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
  const highlights = parseHighlights({ ...state.latestHighlights, version: state.latestVersion }, state.latestVersion);
  const command = installMethod(scriptPath) === 'dsh' ? dshUpdateCommand(scriptPath) : UPDATE_COMMANDS[installMethod(scriptPath)];
  return { latest: state.latestVersion, current, command, highlights };
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

// Accept only x.y.z version numbers and ignore anything else, so arbitrary remote text never reaches the Agent's context. The
// highlights go only into state.json and the page (parseHighlights).
export async function runUpdateCheck(home, fetchImpl = fetch) {
  try {
    const { version } = await fetchJson(fetchImpl, UPDATE.url);
    if (!parseVersion(version)) return null;
    const latest = version.trim();
    // The highlights are optional: a missing or malformed file leaves the version check as it was.
    const highlights = parseHighlights(await fetchJson(fetchImpl, UPDATE.highlightsUrl).catch(() => null), latest);
    writeState(home, { latestVersion: latest, latestHighlights: highlights, lastUpdateCheck: Date.now() });
    return latest;
  } catch {
    return null;
  }
}

async function fetchJson(fetchImpl, url) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(UPDATE.timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
