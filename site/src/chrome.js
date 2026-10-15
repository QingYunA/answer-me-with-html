// CSS for a sample page shown inside a frame on the site. Shared by the build (site/build.mjs adds it to the theme previews), live.js and theme.js.
// The page also ends in a toolbar and a colophon (and starts with the toolbar's own row); a preview shows only the page itself, without scrollbars.
export const HIDE_CHROME = '.am-toolbar,.am-colophon{display:none!important}html{scrollbar-width:none}::-webkit-scrollbar{display:none}';
export const PREVIEW_CSS = `${HIDE_CHROME}html,body{overflow:hidden!important}`;
