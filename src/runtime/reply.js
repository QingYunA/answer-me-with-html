// Answer on the page: every panel gets a Comment box, and the Reply button collects the ask answers and the comments
// into one Markdown reply (replyText) to copy back to the agent. Answers and comments stay in localStorage across reloads.
const replyBtn = document.querySelector('[data-am="reply"]');
const COMMENT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
if (replyBtn) {
  const ui = JSON.parse(replyBtn.dataset.ui);
  const storeKey = `am-reply:${location.pathname}`;
  const panels = [...document.querySelectorAll('.am-panel')];
  const asks = [...document.querySelectorAll('.am-ask')];
  // Answers are saved by question text, so they still match after am patch has renumbered the asks.
  // Page text without the word joiners a right-to-left page puts after a Hebrew prefix hyphen (src/bidi.js): the reply and the saved
  // answers hold the text as the draft wrote it.
  const WJ = new RegExp(String.fromCharCode(0x2060), 'g');
  const textOf = (el) => el?.textContent.replace(WJ, '').trim();
  const keyOf = (ask) => textOf(ask.querySelector('legend')) ?? ask.dataset.ask;
  const touched = new Set();
  const boxes = new Map();

  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(storeKey)) || {};
    } catch {
      return {};
    }
  };
  const save = () => {
    const state = {
      asks: Object.fromEntries(asks.map((a) => [keyOf(a), { picked: picked(a), touched: touched.has(a) }])),
      comments: Object.fromEntries([...boxes].map(([id, box]) => [id, box.value]).filter(([, text]) => text.trim())),
    };
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
    } catch {
      // Storage may be off (private window, file:// policy); answers then last until the page closes.
    }
  };
  const picked = (ask) => [...ask.querySelectorAll('input')].filter((i) => i.checked).map((i) => i.value);
  const panelOf = (el) => {
    const panel = el.closest('.am-panel');
    return { id: panel?.id.replace(/^panel-/, '') ?? '', title: textOf(panel?.querySelector('.am-panel-head h2')) ?? '' };
  };

  const saved = load();
  for (const ask of asks) {
    const inputs = [...ask.querySelectorAll('input')];
    const state = saved.asks?.[keyOf(ask)];
    // A saved answer applies only while every picked option still exists on the page.
    if (state && state.picked.every((v) => inputs.some((i) => i.value === v))) {
      for (const input of inputs) input.checked = state.picked.includes(input.value);
      if (state.touched) touched.add(ask);
    }
    // A click counts even on the option that is already picked: the reader confirms the suggestion.
    const answer = () => {
      touched.add(ask);
      save();
    };
    ask.addEventListener('change', answer);
    ask.addEventListener('click', (e) => { if (e.target.matches('input')) answer(); });
  }

  for (const panel of panels) {
    const id = panel.id.replace(/^panel-/, '');
    // An icon only: narrow panels have no room for a word next to the title.
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'am-comment-btn', title: ui.comment, innerHTML: COMMENT_ICON });
    btn.setAttribute('aria-label', `${ui.comment} ${id}`);
    btn.setAttribute('aria-expanded', 'false');
    const wrap = Object.assign(document.createElement('div'), { className: 'am-comment', hidden: true });
    const box = Object.assign(document.createElement('textarea'), { rows: 3, placeholder: ui.commentHint, value: saved.comments?.[id] ?? '' });
    box.setAttribute('aria-label', `${ui.comment} ${id}`);
    wrap.append(box);
    const show = (open) => {
      wrap.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', () => {
      show(wrap.hidden);
      if (!wrap.hidden) box.focus();
    });
    box.addEventListener('input', () => {
      btn.classList.toggle('am-comment-btn--on', Boolean(box.value.trim()));
      save();
    });
    btn.classList.toggle('am-comment-btn--on', Boolean(box.value.trim()));
    if (box.value.trim()) show(true);
    (panel.querySelector('.am-panel-head') ?? panel).append(btn);
    panel.append(wrap);
    boxes.set(id, box);
  }

  const sheet = document.createElement('dialog');
  sheet.className = 'am-reply';
  sheet.setAttribute('aria-label', ui.title);
  sheet.innerHTML = '<div class="am-reply-head"><strong></strong><span></span></div><textarea readonly rows="14"></textarea><div class="am-reply-actions"><button type="button" class="am-btn" data-act="copy"></button><button type="button" class="am-btn" data-act="close"></button></div>';
  sheet.querySelector('strong').textContent = ui.title;
  sheet.querySelector('span').textContent = ui.hint;
  const text = sheet.querySelector('textarea');
  const copy = sheet.querySelector('[data-act="copy"]');
  const close = sheet.querySelector('[data-act="close"]');
  copy.textContent = ui.copy;
  close.textContent = ui.close;
  document.body.append(sheet);

  const compose = () => {
    const decisions = asks.map((ask) => ({
      panel: panelOf(ask).id,
      question: textOf(ask.querySelector('legend')) ?? '',
      picked: picked(ask),
      suggested: [...ask.querySelectorAll('input[data-suggested]')].map((i) => i.value),
      touched: touched.has(ask),
    }));
    const comments = [...boxes].map(([id, box]) => ({ panel: id, title: panelOf(box).title, text: box.value }));
    const empty = !decisions.length && !comments.some((c) => c.text.trim());
    const title = textOf(document.querySelector('.am-head h1')) ?? document.title;
    return empty ? '' : replyText({ title, decisions, comments, ui, rtl: document.documentElement.dir === 'rtl' });
  };

  replyBtn.addEventListener('click', () => {
    const reply = compose();
    text.value = reply || ui.empty;
    copy.disabled = !reply;
    if (sheet.showModal) sheet.showModal();
    else sheet.setAttribute('open', '');
    (reply ? copy : close).focus();
  });
  close.addEventListener('click', () => (sheet.close ? sheet.close() : sheet.removeAttribute('open')));
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text.value);
    } catch {
      text.select();
      document.execCommand('copy');
    }
    copy.textContent = ui.done;
    setTimeout(() => { copy.textContent = ui.copy; }, 1400);
  });
}
