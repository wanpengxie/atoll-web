import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';

// `@` and `/` are separate input modes, not text to be spliced back out of the
// message afterwards. ProseMirror owns the trigger range, so selecting a row
// edits the document in one transaction and the body never has to be read,
// rewritten, or round-tripped through the durable draft.
//
// The plugin is created once per editor, so everything that changes between
// renders — the candidate rows, the active row, the command to run — is read
// through `port`, a ref the component keeps current.
export function createSuggestionExtension({ name, char, startOfLine = false, allowedPrefixes = null, port }) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        Suggestion({
          // Each mode is its own keyed plugin; the shared default key would
          // make the second registration collide with the first.
          pluginKey: new PluginKey(name),
          editor: this.editor,
          char,
          startOfLine,
          allowedPrefixes,
          // Escape closes this trigger for good; a later trigger elsewhere in
          // the document opens normally. Anchoring on the range start makes
          // that precise rather than comparing whole-document text.
          allow: ({ range }) => port.current?.allow?.(name, range) !== false,
          items: ({ query }) => port.current?.items?.(name, query) || [],
          command: ({ editor, range, props }) => port.current?.select?.(name, { editor, range, item: props }),
          render: () => ({
            onStart: (props) => port.current?.open?.(name, props),
            onUpdate: (props) => port.current?.open?.(name, props),
            onKeyDown: (props) => port.current?.keyDown?.(name, props) === true,
            onExit: () => port.current?.close?.(name),
          }),
        }),
      ];
    },
  });
}
