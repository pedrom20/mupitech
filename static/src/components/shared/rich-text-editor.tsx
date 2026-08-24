import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FaBold, FaItalic, FaUnderline, FaListUl, FaListOl, FaLink, FaEraser } from 'react-icons/fa'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

/**
 * Minimal contentEditable-based rich text editor — bold/italic/underline,
 * lists, and links, which is all the offline-alert intro editor needs.
 * Deliberately not a full library (Quill/TipTap/...): the only consumer
 * is one short admin-authored paragraph, so a toolbar over
 * document.execCommand keeps this dependency-free.
 *
 * Uncontrolled after mount by design — `value` seeds the initial content
 * once; re-syncing innerHTML on every keystroke would reset the caret
 * position. To force a reset (e.g. "restore default"), remount via a
 * changing `key` prop from the parent instead of relying on `value`.
 */
const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange, placeholder }) => {
  const { t } = useTranslation()
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = value || ''
    }
    // Intentionally run once on mount only — see the doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exec = (command: string, arg?: string) => {
    editorRef.current?.focus()
    document.execCommand(command, false, arg)
    onChange(editorRef.current?.innerHTML || '')
  }

  const handleLink = () => {
    const url = window.prompt(t('alerts.introEditorLinkPrompt'))
    if (url) exec('createLink', url)
  }

  const toolbarButtons: Array<{ icon: React.ReactNode; onClick: () => void; label: string }> = [
    { icon: <FaBold />, onClick: () => exec('bold'), label: 'Bold' },
    { icon: <FaItalic />, onClick: () => exec('italic'), label: 'Italic' },
    { icon: <FaUnderline />, onClick: () => exec('underline'), label: 'Underline' },
    { icon: <FaListUl />, onClick: () => exec('insertUnorderedList'), label: 'Bullet list' },
    { icon: <FaListOl />, onClick: () => exec('insertOrderedList'), label: 'Numbered list' },
    { icon: <FaLink />, onClick: handleLink, label: 'Link' },
    { icon: <FaEraser />, onClick: () => exec('removeFormat'), label: 'Clear formatting' },
  ]

  return (
    <div className="rich-text-editor">
      <div className="btn-toolbar mb-1" role="toolbar">
        <div className="btn-group btn-group-sm">
          {toolbarButtons.map((btn, i) => (
            <button
              key={i}
              type="button"
              className="btn btn-outline-secondary"
              title={btn.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={btn.onClick}
            >
              {btn.icon}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={editorRef}
        className="form-control rich-text-editor-content"
        contentEditable
        data-placeholder={placeholder}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        onBlur={(e) => onChange(e.currentTarget.innerHTML)}
      />
    </div>
  )
}

export default RichTextEditor
