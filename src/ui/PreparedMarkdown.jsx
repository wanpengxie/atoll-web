import React from 'react';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { urlAttributes } from 'html-url-attributes';
import { defaultUrlTransform } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

const HAST_PROCESSOR = unified()
  // Match react-markdown's default: raw Markdown HTML becomes HAST `raw`, but
  // is never parsed into executable elements.
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeKatex, { strict: false, throwOnError: false, trust: false });

// ContentPlan owns the bounded lifetime of every prepared root. This weak
// cache therefore cannot keep evicted content alive, while an exact
// StrictMode replay or virtual-list remount can reuse the immutable React
// description instead of rebuilding the complete HAST/JSX tree.
const PREPARED_RENDERS = new WeakMap();
const NO_COMPONENTS = Object.freeze({});

function protectHast(tree, urlTransform) {
  visit(tree, (node, index, parent) => {
    if (node.type === 'raw' && parent && typeof index === 'number') {
      parent.children[index] = { type: 'text', value: node.value };
      return index;
    }
    if (node.type !== 'element') return undefined;
    for (const [key, appliesTo] of Object.entries(urlAttributes)) {
      if (!Object.hasOwn(node.properties, key)) continue;
      if (appliesTo !== null && !appliesTo.includes(node.tagName)) continue;
      node.properties[key] = urlTransform(String(node.properties[key] || ''), key, node);
    }
    return undefined;
  });
}

// ContentPlan already ran remark-parse + GFM + math + breaks over the complete
// document. This component performs only mdast→hast, KaTeX, URL protection,
// and React element creation. It intentionally mirrors the subset of
// react-markdown options used by MarkdownContent.
export function prepareMarkdownTree(root, components, urlTransform = defaultUrlTransform) {
  if (!root || root.type !== 'root') throw new TypeError('PreparedMarkdown requires a prepared mdast root');
  const componentKey = components || NO_COMPONENTS;
  let byComponents = PREPARED_RENDERS.get(root);
  if (!byComponents) {
    byComponents = new WeakMap();
    PREPARED_RENDERS.set(root, byComponents);
  }
  let byTransform = byComponents.get(componentKey);
  if (!byTransform) {
    byTransform = new WeakMap();
    byComponents.set(componentKey, byTransform);
  }
  const cached = byTransform.get(urlTransform);
  if (cached) return cached;
  const tree = HAST_PROCESSOR.runSync(root);
  protectHast(tree, urlTransform);
  const prepared = toJsxRuntime(tree, {
    Fragment,
    components,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
  });
  byTransform.set(urlTransform, prepared);
  return prepared;
}

export function PreparedMarkdown({ root, components, urlTransform = defaultUrlTransform }) {
  return prepareMarkdownTree(root, components, urlTransform);
}
