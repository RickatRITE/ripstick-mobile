/** TipTap editor setup for mobile — same engine as desktop, vanilla JS (no React). */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';

let editorInstance: Editor | null = null;

/** Create and mount a TipTap editor into the given DOM element. */
export function createEditor(element: HTMLElement, content: string): Editor {
  destroyEditor();

  editorInstance = new Editor({
    element,
    content,
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: 'code-block' } },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        html: false,
        transformPastedText: false,
        transformCopiedText: true,
      }),
    ],
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
