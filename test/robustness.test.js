// Robustness: feed malformed input to every component and to whole drafts; the bundled CLI must not hang or report an "internal error".
// Only normal errors are allowed (syntax error hints, exit code 1/2). Each case runs in a child process; a timeout catches hangs.
// A batch runs as many cases at once as the machine has cores, at most 8 so a many-core machine with little memory
// does not start dozens of Node processes: one after another, the ~400 CLI starts took about a minute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AM = fileURLToPath(new URL('../skills/answer-me-with-html/scripts/am.mjs', import.meta.url));
const COMPONENTS = ['flow', 'state', 'er', 'sequence', 'tree', 'timeline', 'limits', 'annot', 'kv', 'callout'];
const BODIES = ['', ' ', '|', '||||', '->', '-->', 'A ->', '-> B', ':', '0', '0 / 0', '-1 / 0', 'NaN / NaN', 'x | 1e308 / 1e-308',
  'a | 5 / -3', 'max 0', '[', '{', '[(', '((((', '*', 'group g: X', 'note A: x', '== ==', 'participants:', 'A -> A', '#',
  '[x]{', '[x]{!', '> ', '\u0000 -> B', '__group0 -> B\ngroup G: B', 'g0 -> n0\ngroup g0: n0', '😀 -> 🚀: 💥',
  'a'.repeat(3000), 'A -> B\n'.repeat(200), '  x\n y\n   z\n\tw', 'A -> B & & C', `Order
  user_id FK -> Usr`, `User 1--* Ordr`, `Employee
  manager_id FK -> Employee`, `USER ||--o{ ORDER`, `A
B
A 0..1--* B: x`];
const DOCS = ['---', '---\ncols: 0\n---\n## A\nx', '---\ncols: 999999\n---\n## A\nx', '## {span=99 rows=99}\nx', '## A {meta="}\nx',
  '```\nunclosed', '| a |\n|---|\n| ok |', '---\ntitle: "Issue #1"\n---\n## A\nx'];

function runCase(args, input, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, timeout: 10000 });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdout.resume();
    child.stdin.on('error', () => {}); // the CLI may exit before it reads all of stdin
    child.on('error', (error) => resolve({ error }));
    child.on('close', (status, signal) => resolve({ status, signal, stderr }));
    child.stdin.end(input);
  });
}

async function runBatch(cases, args) {
  const home = mkdtempSync(join(tmpdir(), 'am-robust-'));
  const env = { ...process.env, AM_HOME: home, AM_NO_UPDATE_CHECK: '1', AM_NO_OPEN: '1' };
  const check = async (i) => {
    const [label, input] = cases[i];
    const r = await runCase([AM, ...args, '-o', join(home, `out-${i}.html`)], input, env);
    if (r.error || r.signal) return { label, timedOut: true, message: `${label}: ${r.error?.code ?? r.signal}` };
    if (r.status > 2 || /Internal error/.test(r.stderr)) return { label, message: `${label}: ${r.stderr.split('\n')[0]}` };
    return null;
  };
  try {
    const failures = [];
    let next = 0;
    const worker = async () => {
      while (next < cases.length) {
        const i = next++;
        const failure = await check(i);
        if (failure) failures.push({ i, ...failure });
      }
    };
    await Promise.all(Array.from({ length: Math.min(availableParallelism(), 8) }, worker));
    // On a busy machine a case can miss the timeout without hanging. Run each timed-out case again on its own:
    // a real hang times out again.
    const confirmed = [];
    for (const f of failures) {
      if (!f.timedOut) confirmed.push(f.message);
      else {
        const again = await check(f.i);
        if (again) confirmed.push(again.message);
      }
    }
    return confirmed.sort();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

for (const c of COMPONENTS) {
  test(`robustness: malformed input to the ${c} component neither hangs nor crashes`, { timeout: 120000 }, async () => {
    const cases = BODIES.map((b, i) => [`${c}#${i}`, `## A t\n\`\`\`${c}\n${b}\n\`\`\`\n`]);
    assert.deepEqual(await runBatch(cases, ['render', '-', '--no-open']), []);
  });
}

test('robustness: malformed draft structure neither hangs nor crashes', { timeout: 120000 }, async () => {
  assert.deepEqual(await runBatch(DOCS.map((d, i) => [`doc#${i}`, d]), ['render', '-', '--no-open']), []);
});

test('robustness: malformed video drafts neither hang nor crash', { timeout: 120000 }, async () => {
  const videos = ['', '> 只有旁白', '## 空\n', '## A\n> [', '## A\n> [不存在]', '## A\n```limits\nA | 0 / 0\n```\n> x',
    '## A\n```flow\n\u0000 -> B\n```\n> [B]', '## A\n```tree\nA\n  A\n```\n> [A]', '---\ntheme: neon\n---\n## A\n> x'];
  assert.deepEqual(await runBatch(videos.map((v, i) => [`video#${i}`, v]), ['video', '-', '--voice', 'off', '--no-open']), []);
});
