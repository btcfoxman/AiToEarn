import type { MutableRefObject } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  PASTE_COMMAND,
} from 'lexical'
import { BeautifulMentionNode } from 'lexical-beautiful-mentions'
import { useEffect, useRef } from 'react'

/**
 * 插件：根据外部 value 同步更新编辑器内容
 */
export function InitialValuePlugin({
  value,
  lastOutputValueRef,
  enableTopicMentions = true,
}: {
  value: string
  lastOutputValueRef?: MutableRefObject<string>
  enableTopicMentions?: boolean
}) {
  const [editor] = useLexicalComposerContext()
  const lastTopicModeRef = useRef(enableTopicMentions)

  useEffect(() => {
    const topicModeChanged = lastTopicModeRef.current !== enableTopicMentions

    // 如果 value 是编辑器自身 onChange 回传的，跳过（无竞态，ref 同步设置）
    if (!topicModeChanged && lastOutputValueRef && value === lastOutputValueRef.current) {
      return
    }

    // 在 editor.update() 外部读取当前文本，避免空更新触发 OnChangePlugin
    const currentText = editor.getEditorState().read(() => $getRoot().getTextContent())
    if (!topicModeChanged && value === currentText) {
      return
    }

    // 只在真正需要时才更新编辑器
    lastTopicModeRef.current = enableTopicMentions
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      root.append(paragraph)

      if (!value) {
        return
      }

      // 按原顺序拆分：话题片段形如 "#xxx"
      if (!enableTopicMentions) {
        const lines = value.split(/\r?\n/)
        lines.forEach((line, index) => {
          const targetParagraph = index === 0 ? paragraph : $createParagraphNode()
          if (index > 0) {
            root.append(targetParagraph)
          }
          targetParagraph.append($createTextNode(line))
        })
        return
      }

      const parts = value.split(/(#\S+)/g).filter(Boolean)

      parts.forEach((part) => {
        if (part.startsWith('#')) {
          const topic = part.slice(1)
          if (topic) {
            // @ts-ignore 构造函数依库版本
            const mentionNode = new BeautifulMentionNode('#', topic)
            paragraph.append(mentionNode)
          }
        }
        else {
          if (part) {
            paragraph.append($createTextNode(part))
          }
        }
      })
    })
  }, [editor, value, lastOutputValueRef, enableTopicMentions])

  return null
}

export function PasteTopicsPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const clipboardText = event.clipboardData?.getData('text/plain')
        if (!clipboardText)
          return false

        event.preventDefault()

        editor.update(() => {
          const selection = $getSelection()
          // 仅处理普通范围选区
          if (!$isRangeSelection(selection))
            return

          // 删除当前选区内容
          selection.removeText()

          const lines = clipboardText.split(/\r?\n/)
          lines.forEach((line, idx) => {
            const parts = line.split(/(#\S+)/g).filter(Boolean)
            parts.forEach((part) => {
              if (part.startsWith('#')) {
                const topic = part.slice(1)
                if (topic) {
                  // @ts-ignore
                  const mentionNode = new BeautifulMentionNode('#', topic)
                  selection.insertNodes([mentionNode])
                }
              }
              else {
                selection.insertText(part)
              }
            })
            // 换行 -> 新段落
            if (idx < lines.length - 1) {
              const p = $createParagraphNode()
              selection.insertNodes([p])
              p.select()
            }
          })
        })

        return true
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor])

  return null
}
