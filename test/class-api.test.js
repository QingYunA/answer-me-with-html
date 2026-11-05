import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, ComponentError } from '../src/components/index.js';
import { parseClass } from '../src/components/class.js';
import { parseApi } from '../src/components/api.js';
import { renderDoc, RenderError } from '../src/render.js';
import { resolveLanguage } from '../src/language.js';

// render exercises a registered component with the same context supplied by the page renderer.
const render = (name, text, args = '', dir = 'ltr') => COMPONENTS.get(name).render(text, { args, dir, uid: () => 'contract-test' });

// Class declarations retain signatures and their source positions for rendering and error reporting.
test('class: parses classes, interfaces, enums, visibility and generic members', () => {
  const model = parseClass('abstract Entity\n  #id: string\ninterface Store<T>\n  +get(id: string): T\nenum Status\n  Active\nclass *User\n  -status: Status\nUser --|> Entity: extends');
  assert.deepEqual([...model.classes.values()].map((c) => c.kind), ['abstract', 'interface', 'enum', 'class']);
  assert.equal(model.classes.get('User').hi, true);
  assert.deepEqual(model.classes.get('Store<T>').members, ['+get(id: string): T']);
  assert.deepEqual(model.relations[0], { from: 'User', kind: '--|>', to: 'Entity', label: 'extends', line: 9 });
});

// UML arrowheads encode distinct relationships; diamonds must remain at the owning end.
test('class: draws inheritance, realization, ownership, association and dependency ends', () => {
  for (const [kind, marker, end] of [['--|>', 'triangle', 'end'], ['..|>', 'triangle', 'end'], ['*--', 'filled', 'start'], ['o--', 'diamond', 'start'], ['-->', 'open', 'end'], ['..>', 'open', 'end']]) {
    const svg = render('class', `A\nB\nA ${kind} B: relation`);
    assert.ok(svg.includes(`marker-${end}="url(#contract-test-${marker})"`), kind);
    assert.equal(svg.includes('class="am-edge am-edge--dashed"'), kind.startsWith('..'), kind);
    assert.match(svg, />relation<\/text>/);
  }
  assert.doesNotMatch(render('class', 'A\nB\nA -- B'), /marker-(start|end)=/);
});

// All directions and cycles must yield finite, positive SVG geometry, including multiple edges and self-links.
test('class: handles layout directions, self-links, cycles and parallel links', () => {
  for (const direction of ['TB', 'LR', 'BT', 'RL']) {
    const svg = render('class', 'A\n  +id: string\nB\nA --> A: parent\nA --> B: owns\nA ..> B: uses\nB --> A', direction);
    assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
    const box = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    assert.ok(Number(box[1]) > 0 && Number(box[2]) > 0);
    assert.equal((svg.match(/<g data-step=/g) ?? []).length, 4);
  }
});

// Compartment sizing follows the text actually drawn; methods and attributes occupy separate rows.
test('class: separates members, measures long text and escapes markup', () => {
  const short = render('class', 'class A\n  id: int');
  const long = render('class', 'interface A\n  +find(id: string): Map<string, User[]>\n  -name: string\n  +html: <script>alert(1)</script>');
  assert.ok(Number(long.match(/viewBox="0 0 (\d+)/)[1]) > Number(short.match(/viewBox="0 0 (\d+)/)[1]));
  assert.match(long, /«interface»/);
  assert.match(long, /Map&lt;string, User\[\]&gt;/);
  assert.match(long, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(long, /<script>/);
  assert.match(long, /data-key="A"/);
});

// Boundary validation must reject malformed input before dagre can create implicit nodes.
test('class: reports empty input, duplicate declarations, stray members and unknown ends', () => {
  for (const [source, line] of [['', 1], ['  +id: string', 1], ['A\nA', 2], ['A\nA --> Missing', 2], ['A\nA => B', 2], ['class A {', 1]]) {
    assert.throws(() => parseClass(source), (err) => err instanceof ComponentError && err.line === line, source);
  }
});

// HTTP parameter groups and multiple responses retain types and explicit requiredness without guessing defaults.
test('api: parses HTTP parameters, request types, response statuses and field descriptions', () => {
  const { endpoints: [api] } = parseApi('POST /users/{id}\npath\n  id string required | User ID\nquery\n  expand string optional\nheaders\n  Authorization string required\nrequest CreateUserRequest\n  attributes Map<string, User> | Flags | values\nresponse 201 User\n  id string required\nresponse 204');
  assert.equal(api.method, 'POST');
  assert.equal(api.target, '/users/{id}');
  assert.deepEqual(api.sections.map((s) => s.kind), ['path', 'query', 'headers', 'request', 'response', 'response']);
  assert.deepEqual(api.sections[3].fields[0], { name: 'attributes', type: 'Map<string, User>', requirement: '', description: 'Flags | values' });
  assert.equal(api.sections[1].fields[0].requirement, 'optional');
  assert.deepEqual(api.sections.at(-1), { kind: 'response', detail: '204', fields: [] });
});

// RPC contracts display message names and named statuses without imposing HTTP status codes.
test('api: renders RPC messages, optional fields, empty responses and semantic tables', () => {
  const html = render('api', 'RPC users.UserService/GetUser\nrequest GetUserRequest\n  id string required\nresponse OK User\n  email string optional | Contact\nresponse NOT_FOUND');
  assert.match(html, /dir="ltr"><strong>RPC<\/strong>/);
  assert.match(html, /GetUserRequest/);
  assert.match(html, /title="Required">id<\/code>/);
  assert.match(html, /title="Optional">email\?<\/code>/);
  assert.match(html, /<th scope="col">Description<\/th>/);
  assert.match(html, /<th scope="row">/);
  assert.match(html, /NOT_FOUND/);
  assert.equal((html.match(/<table>/g) ?? []).length, 2);
});

// Contract values are plain text, including types and descriptions that contain HTML or Markdown.
test('api: escapes markup in targets, types, section names and descriptions', () => {
  const html = render('api', 'GET /<img>\nresponse 200 <script>\n  data Array<User> optional | <img src=x onerror=alert(1)> **literal**');
  assert.match(html, /\/&lt;img&gt;/);
  assert.match(html, /Array&lt;User&gt;/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; \*\*literal\*\*/);
  assert.doesNotMatch(html, /<img|<script/);
});

// Invalid endpoint and section syntax must preserve the draft line in the error.
test('api: reports malformed endpoints, fields, sections and missing response statuses', () => {
  for (const [source, line] of [['', 1], ['GET users', 1], ['FETCH /users', 1], ['GET /users', 1], ['GET /users\n  id string', 2], ['GET /users\nresponse', 2], ['GET /users\nrequest\n  id', 3], ['GET /users\nunknown', 2], ['RPC S/Get\nquery', 2]]) {
    assert.throws(() => parseApi(source), (err) => err instanceof ComponentError && err.line === line, source);
  }
});

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
  const html = render('api', source);
  assert.equal((html.match(/class="am-api-contract"/g) ?? []).length, 2);
  assert.equal((html.match(/class="am-delta-switch"/g) ?? []).length, 1);
  assert.match(html, /class="am-api am-md am-view-changes"/);
  assert.match(html, /<tr data-delta="removed"><th scope="row">/);
  assert.match(html, /title="Optional">email\?/);
  assert.match(html, /title="Required">email</);
  assert.match(html, /<article class="am-api-contract" data-delta="added">/);
  assert.doesNotMatch(render('api', 'GET /users\nresponse 200'), /am-delta-bar|data-delta=/);
  const video = COMPONENTS.get('api').render(source, { video: true });
  assert.match(video, /am-delta-bar/);
  assert.doesNotMatch(video, /am-delta-switch/);
  const page = renderDoc(`---\nlang: zh\n---\n## API\n\`\`\`api\n${source}\n\`\`\``).html;
  assert.equal(page.match(/data-view="before"[^>]*>([^<]+)/)?.[1], '改前');
  assert.match(page, /\.am-api\.am-view-before \[data-delta="added"\]/);
});

// Page integration includes registry dispatch, localized accessibility labels, RTL diagrams and multiple unique marker IDs.
test('contracts: integrate with localized pages, colon blocks, themes and source-line errors', () => {
  for (const lang of ['en', 'zh', 'zh-TW', 'ja', 'he', 'fr']) {
    const language = resolveLanguage({ declared: lang });
    const { html, stats } = renderDoc(`---\nlang: ${lang}\n---\n## Contracts\n:::class LR\nA\nB\nA --|> B\n:::\n\`\`\`class\nC\nD\nC ..|> D\n\`\`\`\n:::api\nGET /users\nresponse 200\n  id string required\n:::\n\`\`\`er\nUser\n  id PK\n\`\`\``);
    assert.deepEqual(stats.components, { class: 2, api: 1, er: 1 });
    assert.ok(html.includes(language.ui.class));
    assert.ok(html.includes(language.ui.api.response));
    assert.match(html, /id="am1-triangle"/);
    assert.match(html, /id="am2-triangle"/);
    if (lang === 'he') assert.match(html, /role="img"[^>]+direction="rtl"/);
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  }
  assert.throws(() => renderDoc('## Contract\n```class\nA\nA --> Missing\n```'), (err) => err instanceof RenderError && err.line === 4 && err.component === 'class');
  assert.throws(() => renderDoc('## Contract\n```api\nGET /users\nresponse\n```'), (err) => err instanceof RenderError && err.line === 4 && err.component === 'api');
});
