# Answer with clickable sources

When an answer depends on web documentation, keep its evidence in the HTML page. A source name in frontmatter identifies a document, but readers also need links beside the claims and visible URLs they can copy.

The [HTTP 304 example](../examples/source-backed-answer.md) uses ordinary Markdown links. It needs no new component or draft syntax.

## Ask your agent

With Answer me with HTML installed, ask:

> Explain HTTP 304 Not Modified in HTML: when does a conditional GET return it, does it carry content, and what can a cache reuse? Use your available web search tool to find the relevant RFC sections, then read those sections. Put a Markdown source link beside each factual claim. Add a Sources panel whose link labels show the full canonical URLs, including section anchors. Do not copy tool-only citation markers into the draft. If search or fetch fails, report the failure and identify any facts you could not verify.

Use the source page's canonical URL, preserving the relevant section anchor. Check the destination before citing it. Put citations in the Markdown body; a `source:` frontmatter value alone is not a substitute for a source link. Search result IDs and host-specific citation markers do not identify a page for readers of the exported HTML.

## Optional web search through Parallel

You can keep your agent's existing web tools. If you want to use Parallel, add its Unified MCP server to the **host agent's MCP configuration**, following [Parallel MCP setup](https://docs.parallel.ai/integrations/mcp/quickstart). Answer me with HTML renders the draft; the host connects to MCP and handles tool permissions, timeouts and errors.

For Cursor, merge this entry into `.cursor/mcp.json` in your project, keeping any existing server entries. For other hosts, use their configuration format from the setup guide.

```json
{
  "mcpServers": {
    "parallel": {
      "url": "https://mcp.parallel.ai/mcp",
      "headers": {
        "User-Agent": "answer-me-with-html"
      }
    }
  }
}
```

Parallel's `web_search` and `web_fetch` can run without an API key at lower rate limits. No sign-in is needed for this example. In the prompt above, ask the agent to use those tools. For example, the search arguments can be:

```json
{
  "objective": "Find official HTTP documentation explaining when a conditional GET receives 304 Not Modified and whether that response includes content.",
  "search_queries": [
    "RFC 9110 304 Not Modified",
    "MDN 304 conditional GET"
  ]
}
```

Read the returned source URLs with `web_fetch` before drafting. If a tool is unavailable, times out, or returns an error or no usable evidence, say so. Keep the host's permission and timeout settings. You can skip online research and render the checked-in example below; that renders saved content, without claiming a fresh web check.

## Render the example without web access

From a repository checkout with Node.js 20 or newer:

```bash
node skills/answer-me-with-html/scripts/am.mjs render examples/source-backed-answer.md --no-open -o /tmp/source-backed-answer.html
```

Open the HTML file. Each claim has a clickable RFC section link, and the Sources panel shows the full URLs as clickable text. Follow the links to check the evidence. The page can render offline; visiting its external sources needs a network connection.

For your own answer, replace the example's claims and links with evidence you actually read. Keep both forms:

```markdown
A 304 response carries no content. [RFC 9110 §15.4.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5)

## Sources
- RFC 9110 §15.4.5: [https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5)
```
