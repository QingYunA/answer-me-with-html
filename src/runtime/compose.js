// The sheet page script is page.js followed by the layout planner and its DOM adapter, in one function scope.
// planLayout is a plain ES module for tests; the page gets it with its `export` keyword dropped.
// src/assets.js (development) and scripts/build.mjs (bundle) both call this, so the two cannot drift apart.
export function composeRuntime({ page, plan, dom }) {
  return `${page}(() => {\n${plan.replace(/^export /gm, '')}\n${dom}})();\n`;
}
