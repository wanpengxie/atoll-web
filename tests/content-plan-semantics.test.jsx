import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { describe, expect, it } from 'vitest';
import { createContentPlan } from '../src/model/content-plan.js';
import { PreparedMarkdown, prepareMarkdownTree } from '../src/ui/PreparedMarkdown.jsx';

const remarkPlugins = [remarkGfm, remarkMath, remarkBreaks];
const rehypePlugins = [[rehypeKatex, { strict: false, throwOnError: false, trust: false }]];

function html(source) {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{source}</ReactMarkdown>,
  ).replace(/>\n</g, '><');
}

function plannedHTML(source) {
  const plan = createContentPlan({ contentKey: `fixture:${source}`, source });
  return plan.blocks.map((block) => html(block.renderSource)).join('');
}

function preparedHTML(source) {
  const plan = createContentPlan({ contentKey: `prepared:${source}`, source });
  return plan.blocks.map((block) => (block.preparedRoot
    ? renderToStaticMarkup(<PreparedMarkdown root={block.preparedRoot} />)
    : html(block.renderSource))).join('').replace(/>\n</g, '><');
}

describe('ContentPlan semantic boundaries', () => {
  it('[TC-0524][AD-230] reuses one immutable prepared React description for exact render options', () => {
    const plan = createContentPlan({ contentKey: 'prepared-cache', source: '**stable** [link](https://example.test)' });
    const root = plan.blocks[0].preparedRoot;
    const components = {};
    expect(prepareMarkdownTree(root, components)).toBe(prepareMarkdownTree(root, components));
    expect(prepareMarkdownTree(root, {})).not.toBe(prepareMarkdownTree(root, components));
  });

  it.each([
    ['reference definitions', '[official][docs]\n\nplain\n\n[docs]: https://example.test/docs "Docs"'],
    ['one continued list', '- first\n  continued line\n- second\n\n  second paragraph'],
    ['fenced code', 'before\n\n```js\nconst value = `not **markdown**`;\n```\n\nafter'],
    ['block and inline math', 'before $x + y$\n\n$$\na^2+b^2=c^2\n$$\n\nafter'],
    ['GFM table', '| A | B |\n| - | - |\n| one | two |\n\nafter'],
  ])('[TC-0525][AD-231] keeps full-document semantics for %s when top-level blocks render independently', (_name, source) => {
    expect(plannedHTML(source)).toBe(html(source));
    expect(preparedHTML(source)).toBe(plannedHTML(source));
  });

  it.each([
    ['unsafe URLs', '[bad](javascript:alert%281%29) ![bad](vbscript:alert%281%29)'],
    ['raw HTML', '<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>'],
    ['soft and hard breaks', 'soft\nline  \nforced'],
    ['footnotes', 'call[^one]\n\n[^one]: footnote text'],
  ])('[TC-0526][AD-232] matches react-markdown protection and edge semantics for %s', (_name, source) => {
    expect(preparedHTML(source)).toBe(plannedHTML(source));
  });
});
