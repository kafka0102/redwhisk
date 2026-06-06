import { useEffect, useRef } from "react";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

interface IssueDescriptionEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}

function normalizeMarkdown(markdown: string): string {
  return markdown.trimEnd();
}

export function IssueDescriptionEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: IssueDescriptionEditorProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    immediatelyRender: false,
    content: value,
    contentType: "markdown",
    extensions: [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Markdown,
    ],
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        autocapitalize: "none",
        autocorrect: "off",
        class: "issue-description-editor__content",
        role: "textbox",
        spellcheck: "false",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChangeRef.current(normalizeMarkdown(currentEditor.getMarkdown()));
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    const currentValue = normalizeMarkdown(editor.getMarkdown());
    const nextValue = normalizeMarkdown(value);

    if (currentValue === nextValue) {
      return;
    }

    editor.commands.setContent(nextValue, {
      contentType: "markdown",
      emitUpdate: false,
    });
  }, [editor, value]);

  return (
    <div
      className="issue-description-editor"
      data-empty={normalizeMarkdown(value).length === 0 ? "true" : undefined}
    >
      <span className="issue-description-editor__placeholder">
        {placeholder}
      </span>
      <EditorContent editor={editor} />
    </div>
  );
}
