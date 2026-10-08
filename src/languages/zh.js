// Simplified Chinese. One file per fully supported language: the page and player labels it shows.
// `id` is the key theme label objects use for this language.
export default {
  id: 'zh',
  language: 'zh',
  script: 'Hans',
  ui: {
    remark: {
      on: '标注中', off: '标注',
      hint: '批注（可选）', save: '保存', remove: '删除',
      section: '标注',
      kinds: { suggestion: '建议', keep: '保留', question: '疑问', concern: '关注' },
    },
    theme: '主题', modeLabel: '明暗',
    mode: { auto: '跟随系统', light: '亮', dark: '暗' },
    copy: '复制源稿', done: '已复制 ✓', copyCode: '复制',
    reply: {
      button: '回复', comment: '评论', commentHint: '对这个面板的意见', title: '你的回复',
      hint: '复制后粘贴到对话里。', copy: '复制回复', close: '关闭', suggested: '建议',
      empty: '先选择选项，或在面板上写评论。', decisions: '决定', comments: '评论',
      confirmed: '确认了建议', untouched: '未作答，保留建议', was: '原为',
      typed: '以 ">" 开头的行是读者输入的文字。',
    },
    toc: '目录', flow: '流程图', sequence: '时序图', colon: '：', sep: '、',
    expand: '展开查看图表', close: '关闭', diagram: '图表查看',
    delta: { added: '新增', removed: '删除', changed: '修改', view: '视图', before: '改前', changes: '变更', after: '改后' },
  },
  videoUi: { play: '播放', pause: '暂停', chapters: '章节' },
};
