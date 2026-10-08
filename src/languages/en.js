// English. It is also the label set any language without its own file falls back to.
export default {
  id: 'en',
  language: 'en',
  ui: {
    theme: 'Theme', modeLabel: 'Mode',
    mode: { auto: 'Auto', light: 'Light', dark: 'Dark' },
    copy: 'Copy source', done: 'Copied ✓', copyCode: 'Copy',
    reply: {
      button: 'Reply', comment: 'Comment', commentHint: 'Your comment on this panel', title: 'Your reply',
      hint: 'Copy it and paste it into the chat.', copy: 'Copy reply', close: 'Close', suggested: 'suggested',
      empty: 'Pick options, or comment on a panel first.', decisions: 'Decisions', comments: 'Comments',
      confirmed: 'suggestion confirmed', untouched: 'not answered; suggestion kept', was: 'was',
      typed: 'Lines that start with ">" are text the reader typed.',
    },
    toc: 'Contents', flow: 'Flowchart', sequence: 'Sequence diagram', colon: ': ', sep: ', ',
    expand: 'Expand diagram', close: 'Close', diagram: 'Diagram viewer',
    delta: { added: 'added', removed: 'removed', changed: 'changed', view: 'View', before: 'Before', changes: 'Changes', after: 'After' },
  },
  videoUi: { play: 'Play', pause: 'Pause', chapters: 'Chapters', speed: 'Speed', export: 'Export' },
};
