import { esc } from '../svg/text.js';
import { ComponentError, contentLines } from './error.js';
import { FALLBACK } from '../languages/registry.js';

// parseApi reads one HTTP or RPC contract; fields belong to the last declared request or response section.
export function parseApi(text) {
  const lines = contentLines(text);
  const first = lines.shift();
  const endpoint = first?.text.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT|RPC)\s+(\S+)$/);
  if (!endpoint || (endpoint[1] !== 'RPC' && !endpoint[2].startsWith('/'))) {
    throw new ComponentError('api: start with METHOD /path or RPC package.Service/Method', first?.line ?? 1);
  }
  const sections = [];
  let current;
  for (const { raw, text: line, line: n } of lines) {
    if (/^\s/.test(raw)) {
      const [spec, ...description] = line.split(/(?<!\\)\|/).map((part) => part.replace(/\\\|/g, '|'));
      const parts = spec.trim().split(/\s+/);
      const name = parts.shift();
      const requirement = /^(required|optional)$/.test(parts.at(-1)) ? parts.pop() : '';
      const type = parts.join(' ');
      if (!current || !type) throw new ComponentError('api: indent name type [required|optional] | description under a section', n);
      current.fields.push({ name, type, requirement, description: description.join('|').trim() });
      continue;
    }
    const section = line.match(/^(path|query|headers|request|response)(?:\s+(.+))?$/);
    if (!section || (section[1] === 'response' && !section[2])) {
      throw new ComponentError('api: use path, query, headers, request [Type], or response STATUS [Type]', n);
    }
    if (endpoint[1] === 'RPC' && ['path', 'query', 'headers'].includes(section[1])) {
      throw new ComponentError('api: RPC contracts use request and response sections', n);
    }
    current = { kind: section[1], detail: section[2] ?? '', fields: [] };
    sections.push(current);
  }
  if (!sections.length) throw new ComponentError('api needs at least one request, parameter or response section', first.line);
  return { method: endpoint[1], target: endpoint[2], sections };
}

export default {
  name: 'api',
  summary: 'HTTP API or RPC contract (parameters, request and response fields)',
  syntax: `\`\`\`api
POST /users
headers
  Authorization string required | Bearer token
request CreateUserRequest
  email string required | Email address
  name string optional
response 201 User
  id string required
response 400 Error
  message string required
\`\`\`
- One endpoint per block: an uppercase HTTP method and /path, or RPC package.Service/Method.
- Sections: path, query, headers, request [Type], response STATUS [Type]. RPC uses request and response.
- Indent fields: name type [required|optional] | description. Types and descriptions are shown as text, including generics and nested field paths.
- Write \\| for a literal | inside a type, such as string \\| null; the first unescaped | starts the description.
- required and optional are explicit and visible in the Requirement column. If any field declares one, unspecified fields show a dash; otherwise this column is omitted.
- A response requires a status (HTTP code or RPC status name). A section without fields can describe an empty response, such as response 204.
- This displays a contract; it does not send requests or import OpenAPI / protobuf files.`,
  example: '```api\nRPC users.UserService/GetUser\nrequest GetUserRequest\n  id string required\nresponse OK User\n  id string required\n  email string optional\nresponse NOT_FOUND\n```',
  // render emits semantic tables, escaping every author-supplied contract value and translating the surrounding labels.
  render(text, { ui } = {}) {
    const { method, target, sections } = parseApi(text);
    const words = ui?.api ?? FALLBACK.ui.api;
    const body = sections.map(({ kind, detail, fields }) => {
      const described = fields.some((field) => field.description);
      const specified = fields.some((field) => field.requirement);
      const table = fields.length ? `<div class="am-table-wrap"><table><thead><tr><th scope="col">${esc(words.field)}</th><th scope="col">${esc(words.type)}</th>${specified ? `<th scope="col">${esc(words.requirement)}</th>` : ''}${described ? `<th scope="col">${esc(words.description)}</th>` : ''}</tr></thead><tbody>${fields.map((field) => `<tr><th scope="row"><code>${esc(field.name)}</code></th><td><code>${esc(field.type)}</code></td>${specified ? `<td>${field.requirement ? esc(words[field.requirement]) : '—'}</td>` : ''}${described ? `<td>${esc(field.description)}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '';
      return `<section class="am-api-section"><h4>${esc(words[kind])}${detail ? ` <code>${esc(detail)}</code>` : ''}</h4>${table}</section>`;
    }).join('');
    return `<div class="am-api am-md"><div class="am-api-endpoint" dir="ltr"><strong>${esc(method)}</strong> <code>${esc(target)}</code></div>${body}</div>`;
  },
};
