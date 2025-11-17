import {
  autoUpdate,
  flip,
  hide,
  offset,
  shift,
  size,
  useFloating,
  type VirtualElement,
} from "@floating-ui/react";
import { $createCodeNode, CodeNode } from "@lexical/code";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  COPY_COMMAND,
  FORMAT_TEXT_COMMAND,
} from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SELECTION_UPDATE_DELAY = 50;
const BUBBLE_OFFSET = 8;
const BUBBLE_MAX_WIDTH = 360;
const BUBBLE_PADDING = 8;

type BlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "ul"
  | "ol"
  | "quote"
  | "code";
type InlineFormat =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "code"
  | "subscript"
  | "superscript";

interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  subscript: boolean;
  superscript: boolean;
}

const initialFormatState: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  code: false,
  subscript: false,
  superscript: false,
};

function rectsAreEqual(a: DOMRect | null, b: DOMRect | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

function formatStatesAreEqual(a: FormatState, b: FormatState): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.code === b.code &&
    a.subscript === b.subscript &&
    a.superscript === b.superscript
  );
}

export default function SelectionBubbleMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);
  const isBubbleFocusedRef = useRef(false);
  const isPointerDownRef = useRef(false);

  const [blockType, setBlockType] = useState<BlockType>("paragraph");
  const [formatState, setFormatState] =
    useState<FormatState>(initialFormatState);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);

  const syncToolbarState = useCallback(() => {
    if (editor.isComposing()) {
      setSelectionRect(null);
      return;
    }
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        setSelectionRect(null);
        setBlockType("paragraph");
        setFormatState(initialFormatState);
        return;
      }

      const domSelection = window.getSelection();
      const rangeRect =
        domSelection && domSelection.rangeCount > 0
          ? domSelection.getRangeAt(0).getBoundingClientRect()
          : null;
      const computedRect =
        rangeRect && (rangeRect.width || rangeRect.height) ? rangeRect : null;
      setSelectionRect((prev) =>
        rectsAreEqual(prev, computedRect) ? prev : computedRect,
      );

      const element = selection.anchor.getNode().getTopLevelElementOrThrow();
      let heading: HeadingNode | null = null;

      if (element instanceof HeadingNode) {
        heading = element;
      } else {
        const firstChild = element.getFirstChild();
        if (firstChild instanceof HeadingNode) {
          heading = firstChild as HeadingNode;
        }
      }

      if (heading) {
        const tag = heading.getTag();
        if (tag === "h1" || tag === "h2" || tag === "h3") {
          setBlockType(tag);
        } else {
          setBlockType("paragraph");
        }
      } else if (element instanceof ListNode) {
        const listType = element.getListType();
        setBlockType(listType === "number" ? "ol" : "ul");
      } else if (element instanceof QuoteNode) {
        setBlockType("quote");
      } else if (element instanceof CodeNode) {
        setBlockType("code");
      } else {
        setBlockType("paragraph");
      }

      const nextFormatState = {
        bold: selection.hasFormat("bold"),
        italic: selection.hasFormat("italic"),
        underline: selection.hasFormat("underline"),
        strikethrough: selection.hasFormat("strikethrough"),
        code: selection.hasFormat("code"),
        subscript: selection.hasFormat("subscript"),
        superscript: selection.hasFormat("superscript"),
      };
      setFormatState((prev) =>
        formatStatesAreEqual(prev, nextFormatState) ? prev : nextFormatState,
      );
    });
  }, [editor]);

  useEffect(() => {
    const timerRef = { current: 0 };

    const onPointerDown = () => {
      isPointerDownRef.current = true;
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = 0;
      }
    };
    const onPointerUp = () => {
      isPointerDownRef.current = false;
      timerRef.current = window.setTimeout(() => {
        syncToolbarState();
        timerRef.current = 0;
      }, SELECTION_UPDATE_DELAY);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
    };
  }, [syncToolbarState]);

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      if (isBubbleFocusedRef.current || isPointerDownRef.current) return;
      syncToolbarState();
    });
  }, [editor, syncToolbarState]);

  useEffect(() => {
    const root = editor.getRootElement();
    const container =
      (root?.closest(".editor-container") as HTMLElement | null) ||
      root?.parentElement ||
      null;
    setContainerEl(container);
  }, [editor]);

  const virtualRef = useMemo(
    () =>
      ({
        getBoundingClientRect: () => selectionRect ?? new DOMRect(),
      }) as VirtualElement,
    [selectionRect],
  );

  const { x, y, refs, strategy, middlewareData } = useFloating({
    placement: "top",
    strategy: "absolute",
    middleware: [
      offset(BUBBLE_OFFSET),
      flip({ padding: BUBBLE_PADDING, boundary: containerEl ?? undefined }),
      shift({ padding: BUBBLE_PADDING, boundary: containerEl ?? undefined }),
      size({
        apply: ({ elements, availableWidth }) => {
          elements.floating.style.maxWidth =
            Math.min(BUBBLE_MAX_WIDTH, availableWidth) + "px";
        },
        boundary: containerEl ?? undefined,
        padding: BUBBLE_PADDING,
      }),
      hide({ boundary: containerEl ?? undefined }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const open = useMemo(() => {
    const hidden =
      middlewareData.hide?.referenceHidden || middlewareData.hide?.escaped;
    return !!selectionRect && !hidden;
  }, [
    middlewareData.hide?.escaped,
    middlewareData.hide?.referenceHidden,
    selectionRect,
  ]);

  useEffect(() => {
    refs.setReference(virtualRef);
  }, [virtualRef, refs]);

  useEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const onFocusIn = () => {
      isBubbleFocusedRef.current = true;
    };
    const onFocusOut = () => {
      isBubbleFocusedRef.current = false;
      syncToolbarState();
    };
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
    };
  }, [syncToolbarState]);

  const onBlockType = useCallback(
    (type: BlockType) => {
      if (type === "ol") {
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
        return;
      }
      if (type === "ul") {
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
        return;
      }
      if (type === "code") {
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $setBlocksType(selection, () => $createCodeNode());
          }
        });
        return;
      }
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          if (type === "paragraph") {
            $setBlocksType(selection, () => $createParagraphNode());
          } else if (type === "h1" || type === "h2" || type === "h3") {
            $setBlocksType(selection, () => $createHeadingNode(type));
          } else if (type === "quote") {
            $setBlocksType(selection, () => $createQuoteNode());
          }
        }
      });
    },
    [editor],
  );

  const onInlineFormat = useCallback(
    (format: InlineFormat) => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    [editor],
  );

  const onCopy = useCallback(async () => {
    const text = editor.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection) ? selection.getTextContent() : "";
    });
    if (!text) return;
    try {
      const handled = editor.dispatchCommand(COPY_COMMAND, null);
      if (!handled) {
        await navigator.clipboard.writeText(text);
      }
    } catch (error) {
      console.warn("复制失败", error);
    }
  }, [editor]);

  const onDelete = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        return;
      }
      selection.removeText();
    });
  }, [editor]);

  if (!open) return null;

  return createPortal(
    <div
      ref={(node) => {
        refs.setFloating(node);
        bubbleRef.current = node;
      }}
      style={{ position: strategy, top: y ?? 0, left: x ?? 0 }}
      className="bubble-menu"
      role="toolbar"
      aria-label="文本格式化工具栏"
    >
      <fieldset className="bubble-group" aria-label="块级类型">
        <select
          className="bubble-select"
          value={blockType}
          onChange={(e) => onBlockType(e.target.value as BlockType)}
          aria-label="选择块级类型"
        >
          <option value="paragraph">段落</option>
          <option value="h1">H1</option>
          <option value="h2">H2</option>
          <option value="h3">H3</option>
          <option value="ul">无序列表</option>
          <option value="ol">有序列表</option>
          <option value="quote">引用</option>
          <option value="code">代码块</option>
        </select>
      </fieldset>
      <hr className="bubble-divider" />
      <fieldset className="bubble-group" aria-label="文本样式">
        <button
          type="button"
          aria-pressed={formatState.bold}
          aria-label="加粗"
          className={`bubble-button${formatState.bold ? " is-active" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInlineFormat("bold")}
        >
          B
        </button>
        <button
          type="button"
          aria-pressed={formatState.italic}
          aria-label="斜体"
          className={`bubble-button${formatState.italic ? " is-active" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInlineFormat("italic")}
        >
          I
        </button>
        <button
          type="button"
          aria-pressed={formatState.underline}
          aria-label="下划线"
          className={`bubble-button${
            formatState.underline ? " is-active" : ""
          }`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInlineFormat("underline")}
        >
          U
        </button>
        <button
          type="button"
          aria-pressed={formatState.strikethrough}
          aria-label="删除线"
          className={`bubble-button${
            formatState.strikethrough ? " is-active" : ""
          }`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInlineFormat("strikethrough")}
        >
          S
        </button>
        <button
          type="button"
          aria-pressed={formatState.code}
          aria-label="行内代码"
          className={`bubble-button${formatState.code ? " is-active" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInlineFormat("code")}
        >
          {"</>"}
        </button>
        <button
          type="button"
          aria-pressed={formatState.subscript}
          aria-label="下标"
          className={`bubble-button${
            formatState.subscript ? " is-active" : ""
          }`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInlineFormat("subscript")}
        >
          X₂
        </button>
        <button
          type="button"
          aria-pressed={formatState.superscript}
          aria-label="上标"
          className={`bubble-button${
            formatState.superscript ? " is-active" : ""
          }`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInlineFormat("superscript")}
        >
          X²
        </button>
      </fieldset>
      <hr className="bubble-divider" />
      <fieldset className="bubble-group" aria-label="辅助操作">
        <button
          type="button"
          className="bubble-button"
          aria-label="复制选中文本"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCopy}
        >
          复制
        </button>
        <button
          type="button"
          className="bubble-button"
          aria-label="删除所选节点"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onDelete}
        >
          删除
        </button>
      </fieldset>
    </div>,
    containerEl ?? document.body,
  );
}
