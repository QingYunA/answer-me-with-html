// Read a theme submission issue (.github/ISSUE_TEMPLATE/theme.yml). The submission Action (scripts/theme-submission.mjs) and the
// website editor (/themes/new/?issue=<n>) both call parseIssue, so what the bot checks is what the editor shows.
// Pure and browser-safe: no node: imports, no file access.

// An issue form writes "### <label>", a blank line and the answer, and "_No response_" for an empty answer.
const section = (body, label) => {
  const heads = [...body.matchAll(/^###[ \t]+(.+?)[ \t]*$/gm)];
  const at = heads.findIndex((m) => m[1].toLowerCase() === label.toLowerCase());
  if (at < 0) return '';
  const end = heads[at + 1]?.index ?? body.length;
  const value = body.slice(heads[at].index + heads[at][0].length, end).trim();
  return value === '_No response_' ? '' : value;
};

// The text of a ```json fence, or the text itself when the answer has no fence. The last line that closes the fence ends it,
// so a fence-like line inside the answer does not cut the theme short.
const unfence = (value) => value.match(/^(`{3,})[^\n]*\n([\s\S]*)\n\1[ \t]*$/)?.[2] ?? value;

// { name, text, licensed } from the body of a submission issue. An unknown format gives empty strings, which then fail the checks.
// licensed: the License box is ticked. The form requires it, but the author can untick it by editing the issue.
export function parseIssue(body) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n');
  return {
    name: section(text, 'Theme name'),
    text: unfence(section(text, 'Theme JSON')).trim(),
    licensed: /^- \[[xX]\] /m.test(section(text, 'License')),
  };
}
