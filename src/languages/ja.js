// Japanese.
// `langs` are the :lang() ranges the fonts apply to (a range matches the tag and every tag that starts with it, so `ja` covers `ja-JP`).
// Japanese fonts come before Chinese ones: a named Chinese font overrides the language, and Han characters would use Chinese glyphs (`直`, `込`).
// `serif` is the CJK part of a theme's serif stack; the theme puts its own Latin fonts in front.
export default {
  id: 'ja',
  language: 'ja',
  langs: ['ja'],
  fonts: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans CJK JP", "Noto Sans JP", "PingFang SC", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif',
    serif: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", "Songti SC"',
  },
  ui: {
    theme: 'テーマ', modeLabel: '表示',
    mode: { auto: '自動', light: 'ライト', dark: 'ダーク' },
    copy: '原稿をコピー', done: 'コピーしました ✓', copyCode: 'コピー',
    toc: '目次', flow: 'フローチャート', sequence: 'シーケンス図', colon: '：', sep: '、',
  },
  videoUi: { play: '再生', pause: '一時停止', chapters: '章' },
};
