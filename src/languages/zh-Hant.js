// Traditional Chinese. It covers the Hant script and the regions that write it (Taiwan, Hong Kong, Macao), and never borrows the Simplified labels.
// Traditional fonts come before Simplified ones, so systems whose default Chinese font is Simplified still draw Traditional glyphs.
export default {
  id: 'zh-Hant',
  language: 'zh',
  script: 'Hant',
  langs: ['zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO'],
  fonts: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Heiti TC", "Microsoft JhengHei", "Noto Sans CJK TC", "Noto Sans TC", "PingFang SC", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif',
    serif: '"Songti TC", "PMingLiU", "MingLiU", "Noto Serif CJK TC", "Noto Serif TC", "Source Han Serif TC", "Songti SC"',
  },
  ui: {
    theme: '主題', modeLabel: '明暗',
    mode: { auto: '跟隨系統', light: '淺色', dark: '深色' },
    copy: '複製源稿', done: '已複製 ✓', copyCode: '複製',
    toc: '目錄', flow: '流程圖', sequence: '時序圖', colon: '：', sep: '、',
  },
  videoUi: { play: '播放', pause: '暫停', chapters: '章節' },
};
