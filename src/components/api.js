import { esc } from '../svg/text.js';
import { ComponentError, contentLines } from './error.js';
import { FALLBACK } from '../languages/registry.js';
import { splitMarker, markState, deltaAttr, deltaBadge, withDelta } from './delta.js';

// apiState propagates an added or removed contract/section to its children and rejects contradictory markers at the draft boundary.
function apiState(mark, parent, line) {
  const own = markState(mark);
  const inherited = ['added', 'removed'].includes(parent?.state) ? parent.state : null;
  if (inherited && own && own !== inherited) {
    throw new ComponentError(`api: "${mark}" contradicts its ${inherited} parent; remove the marker or move the item`, line);
  }
  const state = inherited ?? own;
  return state ? { state } : {};
}

// parseApi reads HTTP/RPC contracts in source order; markers apply to endpoints, sections or fields, and fields stay under their current section.
export function parseApi(text) {
  const endpoints = [];
  let endpoint;
  let current;
  for (const { raw, text: source, line: n } of contentLines(text)) {
    const { mark, text: line } = splitMarker(source);
    if (/^\s/.test(raw)) {
      const [spec, ...description] = line.split(/(?<!\\)\|/).map((part) => part.replace(/\\\|/g, '|'));
      const parts = spec.trim().split(/\s+/);
      const name = parts.shift();
      const requirement = /^(required|optional)$/.test(parts.at(-1)) ? parts.pop() : '';
      const type = parts.join(' ');
      if (!current || !type) throw new ComponentError('api: indent name type [required|optional] | description under a section', n);
      current.fields.push({ name, type, requirement, description: description.join('|').trim(), ...apiState(mark, current, n) });
      continue;
    }
    const declaration = line.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT|RPC)\s+(\S+)$/);
    if (declaration && (declaration[1] === 'RPC' || declaration[2].startsWith('/'))) {
      endpoint = { method: declaration[1], target: declaration[2], sections: [], line: n, ...apiState(mark, null, n) };
      endpoints.push(endpoint);
      current = null;
      continue;
    }
    if (!endpoint) throw new ComponentError('api: start with METHOD /path or RPC package.Service/Method', n);
    const section = line.match(/^(path|query|headers|request|response)(?:\s+(.+))?$/);
    if (!section || (section[1] === 'response' && !section[2])) {
      throw new ComponentError('api: use path, query, headers, request [Type], or response STATUS [Type]', n);
    }
    if (endpoint.method === 'RPC' && ['path', 'query', 'headers'].includes(section[1])) {
      throw new ComponentError('api: RPC contracts use request and response sections', n);
    }
    current = { kind: section[1], detail: section[2] ?? '', fields: [], ...apiState(mark, endpoint, n) };
    endpoint.sections.push(current);
  }
  if (!endpoints.length) throw new ComponentError('api: start with METHOD /path or RPC package.Service/Method', 1);
  for (const item of endpoints) {
    if (!item.sections.length) throw new ComponentError('api: each endpoint needs at least one request, parameter or response section', item.line);
  }
  return { endpoints };
}

export default {
  name: 'api',
  summary: 'HTTP/RPC contracts and multi-endpoint changes (parameters, requests and responses)',
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
- One or more endpoints per block: start each with an uppercase HTTP method and /path, or RPC package.Service/Method, at column 0.
- Sections: path, query, headers, request [Type], response STATUS [Type]. RPC uses request and response.
- Indent fields: name type [required|optional] | description. Types and descriptions are shown as text, including generics and nested field paths.
- Write \\| for a literal | inside a type, such as string \\| null; the first unescaped | starts the description.
- required and optional are explicit and visible in the Requirement column. If any field declares one, unspecified fields show a dash; otherwise this column is omitted.
- A response requires a status (HTTP code or RPC status name). A section without fields can describe an empty response, such as response 204.
- Prefix an endpoint, section or indented field with + (added), - (removed), or ~ (changed), followed by a space. Children inherit + or -, and a contradictory child marker is an error. ~ marks only the written item.
- To show exact old and new types, names or requirements, write the old field/section/endpoint with - and its replacement with +. A lone ~ has no old value to reconstruct.
- One Before / Changes / After switch applies to every endpoint in the block. Before hides added items; After hides removed items; unchanged items stay in both views. Counts include inherited markers.
- This displays a contract; it does not send requests or import OpenAPI / protobuf files.`,
  example: '```api\nRPC users.UserService/GetUser\nrequest GetUserRequest\n  id string required\nresponse OK User\n  id string required\n  email string optional\nresponse NOT_FOUND\n```',
  // render emits semantic tables, escaping every author-supplied contract value and translating the surrounding labels.
  render(text, { ui, video } = {}) {
    const { endpoints } = parseApi(text);
    const words = ui?.api ?? FALLBACK.ui.api;
    const contracts = endpoints.map(({ method, target, sections, state }) => {
      const body = sections.map(({ kind, detail, fields, state: sectionState }) => {
        const described = fields.some((field) => field.description);
        const specified = fields.some((field) => field.requirement);
        const table = fields.length ? `<div class="am-table-wrap"><table><thead><tr><th scope="col">${esc(words.field)}</th><th scope="col">${esc(words.type)}</th>${specified ? `<th scope="col">${esc(words.requirement)}</th>` : ''}${described ? `<th scope="col">${esc(words.description)}</th>` : ''}</tr></thead><tbody>${fields.map((field) => `<tr${deltaAttr(field.state)}><th scope="row">${deltaBadge(field.state, ui)}<code>${esc(field.name)}</code></th><td><code>${esc(field.type)}</code></td>${specified ? `<td>${field.requirement ? esc(words[field.requirement]) : '—'}</td>` : ''}${described ? `<td>${esc(field.description)}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '';
        return `<section class="am-api-section"${deltaAttr(sectionState)}><h4>${deltaBadge(sectionState, ui)}${esc(words[kind])}${detail ? ` <code>${esc(detail)}</code>` : ''}</h4>${table}</section>`;
      }).join('');
      return `<article class="am-api-contract"${deltaAttr(state)}><div class="am-api-endpoint" dir="ltr">${deltaBadge(state, ui)}<strong>${esc(method)}</strong> <code>${esc(target)}</code></div>${body}</article>`;
    }).join('');
    const states = endpoints.flatMap((endpoint) => [endpoint.state, ...endpoint.sections.flatMap((section) => [section.state, ...section.fields.map((field) => field.state)])]);
    return withDelta(`<div class="am-api am-md">${contracts}</div>`, states, { ui, video });
  },
};
