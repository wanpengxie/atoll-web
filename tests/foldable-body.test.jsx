// @vitest-environment jsdom
// Successor coverage for the deleted fold/foldable-body fixture tree.  Folding
// is now a pure content decision owned by FoldableBody; the test intentionally
// renders that owner directly instead of reviving the old Timeline/fold store.
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FOLD_LINES, FoldableBody, foldCandidate } from '../src/ui/timeline/FoldableBody.jsx';

afterEach(cleanup);

const SHORT = '三行\n而已\n真的';
const LONG = Array.from({ length: FOLD_LINES + 8 }, (_, index) => `第 ${index + 1} 行`).join('\n');

describe('current FoldableBody content contract', () => {
  it('uses stable line and character heuristics without querying layout', () => {
    expect(foldCandidate(SHORT)).toBe(false);
    expect(foldCandidate(LONG)).toBe(true);
    expect(foldCandidate('x'.repeat(1_200))).toBe(true);
    expect(foldCandidate('中文段落'.repeat(160))).toBe(true);
    expect(foldCandidate(Array.from({ length: FOLD_LINES + 1 }, () => 'x').join('\n'))).toBe(false);
  });

  it('folds long content by default and lets the reader expand then collapse it', () => {
    function Harness() {
      const [expanded, setExpanded] = useState(undefined);
      return <FoldableBody
        id="message-1:body"
        text={LONG}
        expanded={expanded}
        onToggle={(_id, folded) => setExpanded(folded)}
      >
        <p>{LONG}</p>
      </FoldableBody>;
    }

    const view = render(<Harness />);
    const body = view.container.querySelector('.message-fold');
    expect(body.classList.contains('is-folded')).toBe(true);
    const expand = screen.getByRole('button', { name: /展开全文/ });
    expect(expand.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(expand);
    expect(view.container.querySelector('.message-fold').classList.contains('is-folded')).toBe(false);
    const collapse = screen.getByRole('button', { name: '收起' });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(collapse);
    expect(screen.getByRole('button', { name: /展开全文/ })).toBeTruthy();
  });

  it('does not add a toggle to short content', () => {
    render(<FoldableBody id="short" text={SHORT}><p>{SHORT}</p></FoldableBody>);
    expect(document.querySelector('.message-fold-toggle')).toBeNull();
    expect(document.querySelector('.message-fold').classList.contains('is-folded')).toBe(false);
  });

  it('automatically expands an explicitly exempt row while retaining manual collapse', () => {
    function Harness() {
      const [expanded, setExpanded] = useState(undefined);
      return <FoldableBody
        id="latest:body"
        text={LONG}
        exempt
        expanded={expanded}
        onToggle={(_id, folded) => setExpanded(folded)}
      >
        <p>{LONG}</p>
      </FoldableBody>;
    }

    const view = render(<Harness />);
    expect(view.container.querySelector('.message-fold').classList.contains('is-folded')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(view.container.querySelector('.message-fold').classList.contains('is-folded')).toBe(true);
    expect(screen.getByRole('button', { name: /展开全文/ })).toBeTruthy();
  });

  it('lets an explicit collapse override automatic expansion', () => {
    render(<FoldableBody id="latest:body" text={LONG} exempt expanded={false}><p>{LONG}</p></FoldableBody>);
    expect(document.querySelector('.message-fold').classList.contains('is-folded')).toBe(true);
    expect(screen.getByRole('button', { name: /展开全文/ })).toBeTruthy();
  });
});
