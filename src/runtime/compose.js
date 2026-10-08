// The sheet page script: page.js, then the reply script with replyText and remarkText, then the remark script, then the layout planner and its DOM adapter.
// replyText, remarkText and planLayout are plain ES modules for tests; the page gets them with their `export` keyword dropped.
// src/assets.js (development) and scripts/build.mjs (bundle) both call this with their own file reader, so the two cannot drift apart.
const unexport = (code) => code.replace(/^export /gm, '');

export function composeRuntime(read) {
  return `${read('page.js')}(() => {\n${unexport(read('reply-text.js'))}\n${read('reply.js')}})();\n(() => {\n${unexport(read('remark-text.js'))}\n${read('remark.js')}})();\n(() => {\n${unexport(read('layout-plan.js'))}\n${read('layout-dom.js')}})();\n`;
}
