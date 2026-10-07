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
    theme: 'ערכת עיצוב', modeLabel: 'מצב',
    mode: { auto: 'אוטומטי', light: 'בהיר', dark: 'כהה' },
    copy: 'העתקת המקור', done: 'הועתק ✓', copyCode: 'העתקה',
    reply: {
      button: 'תגובה', comment: 'הערה', commentHint: 'ההערה שלך על הלוח הזה', title: 'התגובה שלך',
      hint: 'העתיקו והדביקו אותה בצ׳אט.', copy: 'העתקת התגובה', close: 'סגירה', suggested: 'מומלץ',
      empty: 'בחרו אפשרויות, או כתבו הערה על לוח קודם.', decisions: 'החלטות', comments: 'הערות',
      confirmed: 'ההמלצה אושרה', untouched: 'לא נענה; ההמלצה נשארה', was: 'היה',
      typed: 'שורות שמתחילות ב-">" הן טקסט שהקורא הקליד.',
    },
    toc: 'תוכן העניינים', flow: 'תרשים זרימה', sequence: 'תרשים רצף', colon: ': ', sep: ', ',
    expand: 'הגדלת התרשים', close: 'סגירה', diagram: 'מציג התרשים',
    delta: { added: 'נוסף', removed: 'הוסר', changed: 'שונה', view: 'תצוגה', before: 'לפני', changes: 'שינויים', after: 'אחרי' },
  },
  videoUi: { play: 'הפעלה', pause: 'השהיה', chapters: 'פרקים' },
};
