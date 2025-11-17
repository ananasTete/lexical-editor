import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { ListItemNode, ListNode } from "@lexical/list";
import { LINK, TRANSFORMERS } from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import NodeActionIconPlugin from "./plugins/NodeActionIconPlugin";
import SelectionBubbleMenuPlugin from "./plugins/SelectionBubbleMenuPlugin";
import theme from "./theme/editor-theme";
import "./theme/editorStyles.css";

// 错误处理
function onError(error: Error) {
  console.error(error);
}

// 严格排除 Markdown 的 LINK 转换器，防止生成链接节点
const CUSTOM_TRANSFORMERS = TRANSFORMERS.filter(
  (transformer) => transformer !== LINK,
);

// 编辑器初始配置
const initialConfig = {
  namespace: "MarkdownEditor",
  theme,
  onError,
  nodes: [
    HeadingNode,
    ListNode,
    ListItemNode,
    QuoteNode,
    CodeNode,
    CodeHighlightNode,
  ],
};

export default function LexicalEditor() {
  return (
    <div className="editor-container">
      <LexicalComposer initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={<ContentEditable className="editor-input" />}
          placeholder={
            <div className="editor-placeholder">开始输入 Markdown...</div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <MarkdownShortcutPlugin transformers={CUSTOM_TRANSFORMERS} />
        <SelectionBubbleMenuPlugin />
        <NodeActionIconPlugin />
      </LexicalComposer>
    </div>
  );
}
