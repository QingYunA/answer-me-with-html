import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, ComponentError } from '../src/components/index.js';
import { parseApi } from '../src/components/api.js';
import { renderDoc } from '../src/render.js';

// render exercises the registered API component with its localized fallback labels.
const render = (text) => COMPONENTS.get('api').render(text);

// A requirement can contain several HTTP and RPC changes; each declaration resets the field's current section.
test('api: groups HTTP and RPC endpoints without leaking sections or fields', () => {
  const { endpoints } = parseApi('GET /users\nresponse 200 User[]\n  count int required\nRPC Users/Get\nrequest GetUser\n  id string required\nresponse OK User\nPOST /sessions\nresponse 201');
  assert.deepEqual(endpoints.map((endpoint) => [endpoint.method, endpoint.target, endpoint.sections.length]), [['GET', '/users', 1], ['RPC', 'Users/Get', 2], ['POST', '/sessions', 1]]);
  assert.equal(endpoints[0].sections[0].fields[0].name, 'count');
  assert.equal(endpoints[1].sections[0].fields[0].name, 'id');
  assert.equal(endpoints[2].sections[0].fields.length, 0);
  assert.throws(() => parseApi('GET /users\nresponse 200\nPOST /sessions\n  id string'), (err) => err instanceof ComponentError && err.line === 4);
  assert.throws(() => parseApi('GET /users\nPOST /sessions\nresponse 201'), (err) => err instanceof ComponentError && err.line === 1);
});

// Exact replacements preserve both versions; ~ marks the affected endpoint without pretending to contain an old definition.
test('api: retains removed and added field definitions, sections and complete endpoints', () => {
  const { endpoints } = parseApi('~ GET /users/{id}\nresponse 200 User\n  id string required\n  - email string optional | Old\n  + email string required | New\n- response 500 LegacyError\n  message string\n+ POST /users/batch\nrequest BatchRequest\n  ids string[] required\n- RPC Users/GetLegacy\nresponse OK User');
  assert.equal(endpoints[0].state, 'changed');
  assert.equal(endpoints[0].sections[0].state, undefined);
  assert.deepEqual(endpoints[0].sections[0].fields.map((field) => [field.requirement, field.state]), [['required', undefined], ['optional', 'removed'], ['required', 'added']]);
  assert.equal(endpoints[0].sections[1].state, 'removed');
  assert.equal(endpoints[0].sections[1].fields[0].state, 'removed');
  assert.equal(endpoints[1].state, 'added');
  assert.equal(endpoints[1].sections[0].fields[0].state, 'added');
  assert.equal(endpoints[2].sections[0].state, 'removed');
});

// Contradictory descendant markers cannot produce a contract that is missing its parent in either view.
test('api: rejects conflicting markers at the original section or field line', () => {
  for (const [source, line] of [['+ GET /users\n- response 200', 2], ['- RPC Users/Get\nrequest\n  + id string', 3], ['GET /users\n+ response 200\n  ~ id string', 3]]) {
    assert.throws(() => parseApi(source), (err) => err instanceof ComponentError && err.line === line, source);
  }
});

// A single shared view control covers the whole requirement, while plain contracts carry no diff controls.
test('api: renders one shared change switch for multiple endpoints and keeps both field versions', () => {
  const source = '~ GET /users/{id}\nresponse 200 User\n  - email string optional\n  + email string required\n+ RPC Users/BatchGet\nrequest BatchRequest\n  ids string[] required';
  const html = render(source);
  assert.equal((html.match(/class="am-api-contract"/g) ?? []).length, 2);
  assert.equal((html.match(/class="am-delta-switch"/g) ?? []).length, 1);
  assert.match(html, /class="am-api am-md am-view-changes"/);
  assert.match(html, /<tr data-delta="removed"><th scope="row">/);
  assert.match(html, /<td>Optional<\/td>/);
  assert.match(html, /<td>Required<\/td>/);
  assert.match(html, /<article class="am-api-contract" data-delta="added">/);
  assert.doesNotMatch(render('GET /users\nresponse 200'), /am-delta-bar|data-delta=/);
  const video = COMPONENTS.get('api').render(source, { video: true });
  assert.match(video, /am-delta-bar/);
  assert.doesNotMatch(video, /am-delta-switch/);
  const page = renderDoc(`---\nlang: zh\n---\n## API\n\`\`\`api\n${source}\n\`\`\``).html;
  assert.equal(page.match(/data-view="before"[^>]*>([^<]+)/)?.[1], '改前');
  assert.match(page, /\.am-api\.am-view-before \[data-delta="added"\]/);
});
