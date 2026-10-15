#!/usr/bin/env node
import { main, oldNodeHint } from '../src/cli.js';

// background: allow the background check for a new version (not triggered when tests call main directly).
main(process.argv.slice(2), { background: true, scriptPath: process.argv[1] }).then(
  (code) => { process.exitCode = code; },
  (err) => {
    process.stderr.write(`✗ Internal error: ${err.stack || err}\n`);
    const hint = oldNodeHint();
    if (hint) process.stderr.write(`  ${hint}\n`);
    process.exitCode = 1;
  },
);
