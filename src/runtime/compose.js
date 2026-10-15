// The sheet page script: math-text.js around everything, then page.js, then the reply script with replyText, replyViewHtml (and the RTL_LETTER it reads) and remarkText, then the remark script, then the layout planner and its DOM adapter.
// replyText, replyViewHtml, remarkText, the math text helpers and planLayout are plain ES modules for tests; the page gets them with their `export` keyword dropped.
// src/assets.js (development) and scripts/build.mjs (bundle) both call this with their own file reader, so the two cannot drift apart.
const unexport = (code) => code.replace(/^export /gm, '');
export { unexport };

// reply-view.js imports RTL_LETTER from rtl-letter.js (the one definition src/bidi.js uses too); a page script has no imports, so the
// page gets rtl-letter.js itself in front of reply-view.js and the import line is dropped.
const unimport = (code) => code.replace(/^import \{[^}]*\} from '\.\/[\w-]+\.js';\r?\n/gm, '');

export function composeRuntime(read) {
  const scripts = `${read('page.js')}(() => {\n${unexport(read('reply-text.js'))}\n${unexport(read('rtl-letter.js'))}\n${unimport(unexport(read('reply-view.js')))}\n${read('reply.js')}})();\n(() => {\n${unexport(read('remark-text.js'))}\n${read('remark.js')}})();\n(() => {\n${unexport(read('layout-plan.js'))}\n${read('layout-dom.js')}})();\n`;
  // math-text.js is read by the reply script and by the remark script, so it sits around both.
  return `(() => {\n${unexport(read('math-text.js'))}\n${scripts}})();\n`;
}
