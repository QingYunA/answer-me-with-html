// A letter of a right-to-left script. One definition for the page builder (src/bidi.js) and for the right-to-left page script
// (src/runtime/reply-view.js), so the two cannot drift apart. A plain ES module; the page script gets this file in front of
// reply-view.js, with its `export` keyword dropped and reply-view.js's import of it removed (src/runtime/compose.js).
export const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
