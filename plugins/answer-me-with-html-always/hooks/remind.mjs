#!/usr/bin/env node
// answer-me-with-html always-on mode: on UserPromptSubmit, inject one reminder (about 90 tokens) so the agent adds an HTML page when it gives a conclusion.
// It only prints the reminder; it does not read or record user input. After `am config set always off`, it prints nothing.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const REMINDER = [
  '[answer-me-with-html always-on] Whenever this reply states a conclusion, recommendation, summary, plan, comparison,',
  'review or explanation - even a short one - also render a small answer-me-with-html page (2-4 panels, use the',
  'answer-me-with-html skill, render with --no-open so no browser window pops up).',
  'Render the page first, then write the reply last, ending with a file:// link to the page.',
  'Do not skip it because the answer seems short.',
  'Skip only for casual chat, a one- or two-sentence reply with no conclusion, pure command output,',
  'or when the user asks for plain text.',
].join(' ');

// Reads the same file as src/config.js. An installed plugin has only this directory, so a minimal copy is inlined here.
function alwaysEnabled() {
  const file = join(process.env.AM_HOME || join(homedir(), '.answer-me-with-html'), 'config.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8')).always !== false;
  } catch {
    return true;
  }
}

if (alwaysEnabled()) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: REMINDER },
  }));
}
