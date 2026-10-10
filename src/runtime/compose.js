// The sheet page script: page.js, then the reply script with replyText and remarkText, then the remark script, then the layout planner and its DOM adapter.
// replyText, remarkText and planLayout are plain ES modules for tests; the page gets them with their `export` keyword dropped.
// src/assets.js (development) and scripts/build.mjs (bundle) both call this with their own file reader, so the two cannot drift apart.
const unexport = (code) => code.replace(/^export /gm, '');
export { unexport };

// reply-view.js imports RTL_LETTER from rtl-letter.js (the one definition src/bidi.js uses too); a page script has no imports, so the
// page gets rtl-letter.js itself in front of reply-view.js and the import line is dropped.
const unimport = (code) => code.replace(/^import \{[^}]*\} from '\.\/[\w-]+\.js';\r?\n/gm, '');

// Right-to-left pages also get the drawn view of the reply (reply-view.js), after the page script.
export function composeRtlRuntime(read) {
  return `(() => {
${unexport(read('rtl-letter.js'))}
${unimport(unexport(read('reply-view.js')))}})();
`;
}

export function composeRuntime(read) {
  return `${read('page.js')}(() => {\n${unexport(read('reply-text.js'))}\n${read('reply.js')}})();\n(() => {\n${unexport(read('remark-text.js'))}\n${read('remark.js')}})();\n(() => {\n${unexport(read('layout-plan.js'))}\n${read('layout-dom.js')}})();\n`;
}
