// Package entry for installers that require one: dsh-plugin-hub 1.6.6 and older block a git install
// whose package.json entry (index.js by default) is missing. DSH itself loads this package only through
// dsh.bundle.patch (cordis.patch.yml), and the CLI is bin/am.js. Importing this module does nothing.
export {};
