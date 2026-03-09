/** TipTap editor setup for mobile — same engine as desktop, vanilla JS (no React). */

import { Editor } from '@tiptap/core';
import { getBaseExtensions } from '../../shared/tiptap-base';

let editorInstance: Editor | null = null;

export interface MobileEditorOptions {
  /** Resolve `../_assets/foo.webp` → displayable URL (GitHub raw content). */
  resolveImageSrc?: (relativeSrc: string) => string;
}

/**
 * Walk the editor doc and resolve relative `_assets/` image paths to display URLs.
 * Same pattern as desktop's `resolveDocImages` in useEditorNoteSync.ts.
 */
function resolveDocImages(editor: Editor, resolver: (src: string) => string): void {
  const tr = editor.state.tr;
  let hasImages = false;

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && /^(\.\.\/)?_assets\//.test(node.attrs.src || '')) {
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        relativeSrc: node.attrs.src,
        src: resolver(node.attrs.src),
      });
      hasImages = true;
    }
  });

  if (hasImages && !editor.isDestroyed) {
    editor.view.dispatch(tr);
  }
}

/** Create and mount a TipTap editor into the given DOM element. */
export function createEditor(element: HTMLElement, content: string, options?: MobileEditorOptions): Editor {
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

  // Resolve asset paths after content is parsed into the doc
  if (options?.resolveImageSrc) {
    resolveDocImages(editorInstance, options.resolveImageSrc);
  }

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
