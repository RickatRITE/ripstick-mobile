/** TipTap editor setup for mobile — same engine as desktop, vanilla JS (no React). */

import { Editor } from '@tiptap/core';
import { getBaseExtensions } from '../../shared/tiptap-base';

let editorInstance: Editor | null = null;

/** Create and mount a TipTap editor into the given DOM element. */
export function createEditor(element: HTMLElement, content: string): Editor {
  destroyEditor();

  editorInstance = new Editor({
    element,
    content,
    extensions: getBaseExtensions(),
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
      },
    },
  });

  return editorInstance;
}

/** Get the current editor content as markdown. */
export function getMarkdown(): string {
  if (!editorInstance) return '';
  return (editorInstance.storage as Record<string, any>).markdown.getMarkdown() as string;
}

/** Clean up the editor instance. */
export function destroyEditor(): void {
  if (editorInstance) {
    editorInstance.destroy();
    editorInstance = null;
  }
}
