import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SurfaceShell } from '../../../src/app/SurfaceShell.jsx';
import { agentSelectionView } from '../../../src/model/agent-selection.js';
import { Composer } from '../../../src/ui/Composer.jsx';
import { ConversationSurface } from '../../../src/ui/conversation/ConversationSurface.jsx';
import '../../../src/styles/tokens.css';
import '../../../src/styles/base.css';
import '../../../src/styles/app-shell.css';
import '../../../src/styles/responsive.css';
import '../../../src/styles/composer.css';
import '../../../src/styles/features.css';

const roster = [
  { id: 'me', kind: 'human', name: '我' },
  { id: 'peer', kind: 'human', name: '同事' },
  { id: 'agent-1', kind: 'agent', name: 'Agent One' },
];

const describe = {
  words: {
    'agent.select': {
      input_schema: {
        type: 'object',
        oneOf: [
          { required: ['model', 'effort'], properties: { model: { const: 'model-one', title: 'Model One' }, effort: { const: 'medium', title: '中等' } } },
          { required: ['model', 'effort'], properties: { model: { const: 'model-two', title: 'Model Two' }, effort: { const: 'high', title: '高' } } },
        ],
      },
    },
  },
};

function Fixture() {
  const [replyTarget, setReplyTarget] = useState({
    sourceId: 'source-1', senderId: 'peer', senderKind: 'human', senderName: '同事', excerpt: '极短视口回复目标',
  });
  const [attachments, setAttachments] = useState([{ resource_id: 'file-1', name: 'evidence.txt', size: 2048 }]);
  const [sent, setSent] = useState(0);
  const [selection, setSelection] = useState({ model: 'model-one', effort: 'medium' });
  const [selectionCount, setSelectionCount] = useState(0);
  const selectionView = agentSelectionView({ actorId: 'agent-1', describe, usage: selection });
  return <SurfaceShell topology="mobile" className="shell">
    <main style={{ position: 'relative', minWidth: 0, minHeight: 0, height: '100%' }}>
      <header style={{ height: 44, borderBottom: '1px solid var(--line-subtle)' }}>short viewport</header>
      <div style={{ position: 'absolute', inset: '44px 0 0' }}>
        <ConversationSurface input={<Composer
          channelId="c0"
          roster={roster}
          selfId="me"
          draft=""
          onDraftChange={() => ({ revision: 1 })}
          onSend={async () => {
            setSent((value) => value + 1);
            return ['fixture-message'];
          }}
          attachments={attachments}
          onPreviewAttachment={() => {}}
          onRemoveAttachment={(id) => setAttachments((rows) => rows.filter((row) => row.resource_id !== id))}
          onClearAttachments={() => setAttachments([])}
          onUploadAttachments={async () => []}
          onOpenChannelFiles={() => {}}
          agentSelection={{
            fallbackAgentId: 'agent-1',
            fallbackAgentSource: 'fixture',
            view: selectionView,
            onChange: async ({ model, effort }) => {
              setSelection({ model, effort });
              setSelectionCount((value) => value + 1);
            },
          }}
          replyTarget={replyTarget}
          onCancelReply={() => setReplyTarget(null)}
          onReplySent={() => setReplyTarget(null)}
        />}>
          <section className="timeline" aria-label="reading viewport"><div className="timeline-inner">reading</div></section>
        </ConversationSurface>
      </div>
      <output data-testid="sent-count">{sent}</output>
      <output data-testid="selection-count">{selectionCount}</output>
    </main>
  </SurfaceShell>;
}

createRoot(document.getElementById('root')).render(<Fixture />);
