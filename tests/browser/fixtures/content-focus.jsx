import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FoldableBody } from '../../../src/ui/timeline/FoldableBody.jsx';
import { MermaidBlock } from '../../../src/ui/MermaidBlock.jsx';

const longText = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');

function App() {
  const [expanded, setExpanded] = useState(false);
  return <main>
    <FoldableBody id="focus-fold" text={longText} expanded={expanded} onToggle={(_id, next) => setExpanded(next)}>
      <div className="fixture-fold-body">
        <a id="visible-link" href="#visible">visible link</a>
        <div className="fixture-space">selectable preview text</div>
        <button id="hidden-action" type="button">hidden action</button>
      </div>
    </FoldableBody>
    <MermaidBlock code={'graph LR\nA-->B'} layoutKey="focus-mermaid" />
  </main>;
}

const style = document.createElement('style');
style.textContent = `
  body { margin: 20px; font: 16px/20px sans-serif; }
  .message-fold-content { display: flow-root; }
  .message-fold.is-folded > .message-fold-content { max-height: 80px; overflow: hidden; }
  .fixture-fold-body { display: grid; gap: 0; }
  #visible-link { display: block; height: 20px; }
  .fixture-space { height: 120px; }
  #hidden-action { height: 28px; }
  .mermaid-block-shell { position: relative; margin-top: 20px; }
  .mermaid-block-shell > .mermaid-mode-toggle { position: relative; }
  .mermaid-stage { width: 360px; height: 220px; overflow: auto; }
`;
document.head.appendChild(style);
createRoot(document.getElementById('root')).render(<App />);

window.contentFocus = {
  ready: () => Boolean(document.querySelector('.message-fold-toggle') && document.querySelector('.mermaid-mode-toggle')),
  foldState() {
    const visible = document.getElementById('visible-link');
    const hidden = document.getElementById('hidden-action');
    return {
      folded: Boolean(document.querySelector('.message-fold.is-folded')),
      visibleTabIndex: visible.getAttribute('tabindex'),
      visibleAriaHidden: visible.getAttribute('aria-hidden'),
      hiddenTabIndex: hidden.getAttribute('tabindex'),
      hiddenAriaHidden: hidden.getAttribute('aria-hidden'),
    };
  },
  selectPreview() {
    const text = document.querySelector('.fixture-space').firstChild;
    const range = document.createRange();
    range.selectNodeContents(text);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return getSelection().toString();
  },
  mermaidToggleIdentity() {
    const button = document.querySelector('.mermaid-mode-toggle');
    window.__focusMermaidToggle ||= button;
    return {
      same: button === window.__focusMermaidToggle,
      label: button.textContent,
      focused: document.activeElement === button,
    };
  },
};
