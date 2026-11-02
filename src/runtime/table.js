(() => {
  const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  const typedValue = (text) => {
    if (NUMBER.test(text)) return Number(text);
    if (DATE.test(text)) return Date.parse(text);
    return NaN;
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
      while (head.firstChild) button.append(head.firstChild);
      head.append(button);
      button.addEventListener('click', () => {
        const direction = head.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
        for (const cell of headers) cell.removeAttribute('aria-sort');
        head.setAttribute('aria-sort', direction);
        const rows = [...body.rows];
        const texts = rows.map((row) => row.cells[column]?.textContent.trim() ?? '');
        const numeric = texts.every((text) => NUMBER.test(text));
        const dates = texts.every((text) => DATE.test(text) && Number.isFinite(Date.parse(text)));
        const byValue = head.getAttribute('align') === 'right' || numeric || dates;
        const sorted = rows.map((row, index) => ({ row, index, text: texts[index] }));
        sorted.sort((a, b) => {
          let compared;
          if (byValue) {
            const av = typedValue(a.text);
            const bv = typedValue(b.text);
            if (Number.isFinite(av) && Number.isFinite(bv)) compared = av - bv;
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
