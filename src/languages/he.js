// Hebrew. The page is right to left: <html dir="rtl"> comes from the language (src/language.js), not from this file.
// Hebrew fonts come first: Latin-only fonts in front would leave the Hebrew letters to whatever fallback font the system picks.
// `serif` is the Hebrew part of a theme's serif stack; the theme puts its own Latin fonts in front.
export default {
  id: 'he',
  language: 'he',
  langs: ['he'],
  fonts: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Hebrew", "Arial Hebrew", Arial, Roboto, "Helvetica Neue", sans-serif',
    serif: '"Noto Serif Hebrew", "Frank Ruehl CLM", David, "Times New Roman"',
  },
  ui: {
    remark: {
      button: 'סימון',
      hint: 'הערה (אופציונלי)', save: 'שמירה', remove: 'הסרה',
      section: 'סימונים',
      kinds: { suggestion: 'הצעה', keep: 'להשאיר', question: 'שאלה', concern: 'חשש' },
    },
    theme: 'ערכת עיצוב', modeLabel: 'מצב',
    mode: { auto: 'אוטומטי', light: 'בהיר', dark: 'כהה' },
    copy: 'העתקת המקור', done: 'הועתק ✓', copyCode: 'העתקה',
    reply: {
      button: 'תגובה', comment: 'הערה', commentHint: 'ההערה שלך על החלק הזה', title: 'התגובה שלך',
      hint: 'העתיקו והדביקו אותה בצ׳אט.', copy: 'העתקת התגובה', close: 'סגירה', suggested: 'מומלץ',
      empty: 'קודם בחרו אפשרות או כתבו הערה על אחד החלקים.', decisions: 'החלטות', comments: 'הערות',
      confirmed: 'ההמלצה אושרה', untouched: 'לא נענה; ההמלצה נשארה', was: 'היה',
      typed: 'שורות שמתחילות ב-">" הן טקסט שהקורא הקליד.',
    },
    toc: 'תוכן העניינים', flow: 'תרשים זרימה', sequence: 'תרשים רצף', er: 'תרשים ישויות וקשרים', colon: ': ', sep: ', ',
    expand: 'הגדלת התרשים', close: 'סגירה', diagram: 'מציג התרשים',
    delta: { added: 'נוסף', removed: 'הוסר', changed: 'שונה', view: 'תצוגה', before: 'לפני', changes: 'שינויים', after: 'אחרי' },
    generated: 'נוצר באמצעות', limits: { value: '{value} מתוך {limit}', limit: 'עד {limit}' },
  },
  // Names for the frontmatter keys an agent writes most (`author: …`), shown under the title. Other keys show as written.
  metaKeys: {
    author: 'מאת', by: 'מאת', date: 'תאריך', updated: 'עודכן', time: 'שעה', source: 'מקור', sources: 'מקורות', version: 'גרסה',
    status: 'סטטוס', owner: 'אחראי', team: 'צוות', project: 'פרויקט', audience: 'קהל יעד', reviewer: 'בודק', reviewers: 'בודקים',
    license: 'רישיון', licence: 'רישיון', model: 'מודל', repo: 'ריפו', branch: 'ענף', tags: 'תגיות', for: 'עבור', ref: 'הפניה',
  },
  // The word after a change count above one ("+4 נוספו"); the ui.delta words are the singular, for one item and for a node badge.
  deltaCounts: { added: 'נוספו', removed: 'הוסרו', changed: 'שונו' },
  // The render time under the page reads day.month.year, the Israeli way.
  dateOrder: 'dmy',
  videoUi: {
    play: 'הפעלה', pause: 'השהיה', chapters: 'פרקים', speed: 'מהירות', export: 'ייצוא',
    drawn: 'שורטט', date: 'תאריך', scenes: 'סצנות', duration: 'משך', sheet: 'גיליון {n} מתוך {total}',
  },
};
