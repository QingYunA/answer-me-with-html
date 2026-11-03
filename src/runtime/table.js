(() => {
  const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  const FORMATTED_NUMBER = /^[+-]?\$?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)%?$/;
  const INTEGER = /^[+-]?\d+$/;
  const ZERO_FRACTION = /^[+-]?\d+\.0*$/;
  const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  const INTERACTIVE = 'a, button, input, select, textarea, details, audio[controls], video[controls], [contenteditable], [tabindex]';
  const validDate = (text) => {
    if (!DATE.test(text)) return false;
    const [year, month, day] = text.slice(0, 10).split('-').map(Number);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && Number.isFinite(Date.parse(text));
  };
  const numberValue = (text) => {
    let normalized = text;
    if (FORMATTED_NUMBER.test(text)) normalized = text.replace(/[$,%]/g, '');
    else if (!NUMBER.test(text)) return null;
    if (INTEGER.test(normalized)) return BigInt(normalized);
    if (ZERO_FRACTION.test(normalized)) return BigInt(normalized.slice(0, normalized.indexOf('.')));
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  };
  const typedValue = (text) => {
    const number = numberValue(text);
    if (number !== null) return number;
    return validDate(text) ? Date.parse(text) : null;
  };
  const relayout = () => window.dispatchEvent(new Event('resize'));

  for (const table of document.querySelectorAll('table[data-am-table]')) {
    const options = new Set(table.dataset.amTable.split(/\s+/));
    const body = table.tBodies[0];
    if (!body) continue;

    if (options.has('filter')) {
      const controls = table.parentElement.previousElementSibling;
      const input = controls?.classList.contains('am-table-controls') ? controls.querySelector('[data-am-table-filter]') : null;
      if (input) {
        controls.hidden = false;
        input.addEventListener('input', () => {
          const query = input.value.trim().toLocaleLowerCase();
          for (const row of body.rows) row.hidden = Boolean(query) && !row.textContent.toLocaleLowerCase().includes(query);
          relayout();
        });
      }
    }

    if (!options.has('sort')) continue;
    const headers = [...(table.tHead?.rows[0]?.cells ?? [])];
    headers.forEach((head, column) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'am-table-sort';
      button.setAttribute('aria-label', head.textContent.trim());
      const moved = [...head.childNodes].filter((child) => !(child.nodeType === 1 && (child.matches(INTERACTIVE) || child.querySelector(INTERACTIVE))));
      head.insertBefore(button, moved[0] ?? null);
      button.append(...moved);
      button.addEventListener('click', () => {
        const direction = head.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
        for (const cell of headers) cell.removeAttribute('aria-sort');
        head.setAttribute('aria-sort', direction);
        const rows = [...body.rows];
        const texts = rows.map((row) => row.cells[column]?.textContent.trim() ?? '');
        const numeric = texts.every((text) => numberValue(text) !== null);
        const dates = texts.every(validDate);
        const byValue = head.getAttribute('align') === 'right' || numeric || dates;
        const sorted = rows.map((row, index) => ({ row, index, text: texts[index], value: byValue ? typedValue(texts[index]) : null }));
        sorted.sort((a, b) => {
          let compared;
          if (byValue && (a.value !== null || b.value !== null)) {
            if (a.value === null) compared = 1;
            else if (b.value === null) compared = -1;
            else compared = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
          }
          compared ??= a.text.localeCompare(b.text);
          return compared === 0 ? a.index - b.index : direction === 'ascending' ? compared : -compared;
        });
        body.append(...sorted.map(({ row }) => row));
        relayout();
      });
    });
  }
})();
