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
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import type { LexicalNode } from "lexical";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";

// 常量定义
const SELECTION_UPDATE_DELAY = 50;
const SELECTION_DEBOUNCE_DELAY = 120;
const BUBBLE_OFFSET = 8;
const BUBBLE_MAX_WIDTH = 360;
const BUBBLE_PADDING = 8;

type BlockType = "paragraph" | "h1" | "h2" | "h3" | "ul" | "ol" | "quote" | "code";
type InlineFormat = "bold" | "italic" | "underline" | "strikethrough" | "code" | "subscript" | "superscript";

interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  subscript: boolean;
  superscript: boolean;
}

export default function SelectionBubbleMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const [shouldShow, setShouldShow] = useState(false);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const debounceTimerRef = useRef<number | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);
  const isBubbleFocusedRef = useRef(false);
  const [blockType, setBlockType] = useState<BlockType>("paragraph");
  const [formatState, setFormatState] = useState<FormatState>({
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    code: false,
    subscript: false,
    superscript: false,
  });
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);

  // 辅助函数：检查点击是否在气泡内
  const isClickInsideBubble = useCallback((e: PointerEvent): boolean => {
    return bubbleRef.current?.contains(e.target as Node) ?? false;
  }, []);

  const syncToolbarState = useCallback((): DOMRect | null => {
    // IME 输入法检测：输入法激活时不显示工具栏
    if (editor.isComposing()) {
      setSelectionRect(null);
      return null;
    }

    let rectResult: DOMRect | null = null;
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection) && !selection.isCollapsed()) {
        const domSelection = window.getSelection();
        if (domSelection && domSelection.rangeCount > 0) {
          const r = domSelection.getRangeAt(0).getBoundingClientRect();
          rectResult = (r.width || r.height) ? r : null;
        }

        const element = selection.anchor.getNode().getTopLevelElementOrThrow();
        if (element instanceof HeadingNode) {
          const tag = element.getTag();
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

        setFormatState({
          bold: selection.hasFormat("bold"),
          italic: selection.hasFormat("italic"),
          underline: selection.hasFormat("underline"),
          strikethrough: selection.hasFormat("strikethrough"),
          code: selection.hasFormat("code"),
          subscript: selection.hasFormat("subscript"),
          superscript: selection.hasFormat("superscript"),
        });
      } else {
        rectResult = null;
        setBlockType("paragraph");
        setFormatState({
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
          code: false,
          subscript: false,
          superscript: false,
        });
      }
    });
    setSelectionRect(rectResult);
    return rectResult;
  }, [editor]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (isClickInsideBubble(e)) {
        // 在气泡菜单上交互，不隐藏
        return;
      }
      setIsPointerDown(true);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (isClickInsideBubble(e)) {
        setIsPointerDown(false);
        return;
      }
      setIsPointerDown(false);
      window.setTimeout(() => {
        const r = syncToolbarState();
        setShouldShow(!!r);
      }, SELECTION_UPDATE_DELAY);
    };
    const onSelectionChange = () => {
      if (isPointerDown) return;
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        const r = syncToolbarState();
        setShouldShow(!!r);
      }, SELECTION_DEBOUNCE_DELAY);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [isPointerDown, isClickInsideBubble, syncToolbarState]);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        if (isPointerDown || isBubbleFocusedRef.current) return false;
        const r = syncToolbarState();
        setShouldShow(!!r);
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, isPointerDown, syncToolbarState]);

  // 解析编辑器容器，作为气泡的边界与挂载节点
  useEffect(() => {
    const root = editor.getRootElement();
    const container = (root?.closest('.editor-container') as HTMLElement | null) || (root?.parentElement ?? null);
    setContainerEl(container);
  }, [editor]);

  // 优化后的 open 状态，直接使用缓存的 selectionRect
  const open = useMemo(() => {
    return shouldShow && !!selectionRect;
  }, [shouldShow, selectionRect]);

  const virtualRef = useMemo(
    () => ({
      getBoundingClientRect: () => selectionRect ?? new DOMRect(),
    }) as VirtualElement,
    [selectionRect],
  );

  const {x, y, refs, strategy} = useFloating({
    placement: "top",
    strategy: "absolute",
    middleware: [
      offset(BUBBLE_OFFSET),
      flip({padding: BUBBLE_PADDING, boundary: containerEl ?? undefined}),
      shift({padding: BUBBLE_PADDING, boundary: containerEl ?? undefined}),
      size({
        apply: ({elements, availableWidth}) => {
          elements.floating.style.maxWidth = Math.min(BUBBLE_MAX_WIDTH, availableWidth) + "px";
        },
        boundary: containerEl ?? undefined,
        padding: BUBBLE_PADDING,
      }),
      hide({ boundary: containerEl ?? undefined }),
    ],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    refs.setReference(virtualRef);
  }, [virtualRef, refs]);

  // 监听气泡的焦点进入/离开，避免与 selectionchange 互相干扰
  useEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const onFocusIn = () => { isBubbleFocusedRef.current = true; };
    const onFocusOut = () => { isBubbleFocusedRef.current = false; };
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  const onBlockType = useCallback((type: BlockType) => {
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
  }, [editor]);

  const onInlineFormat = useCallback((format: InlineFormat) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    // 乐观更新，减少视觉延迟
    setFormatState((prev) => ({
      ...prev,
      [format]: !prev[format],
    }));
    // 立即在下一帧同步真实状态，避免与编辑器实际状态不一致
    window.setTimeout(() => {
      syncToolbarState();
    }, 0);
  }, [editor, syncToolbarState]);

  const onCopy = useCallback(async () => {
    const text = editor.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection) ? selection.getTextContent() : "";
    });
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.warn("复制失败", error);
    }
  }, [editor]);

  const onDelete = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        return;
      }
      const nodes = selection.getNodes();
      const seenKeys = new Set<string>();
      const topLevelNodes: LexicalNode[] = [];
      for (const n of nodes) {
        const top = n.getTopLevelElementOrThrow();
        const key = top.getKey();
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          topLevelNodes.push(top);
        }
      }
      if (topLevelNodes.length === 0) {
        const anchorTop = selection.anchor.getNode().getTopLevelElementOrThrow();
        anchorTop.remove();
        return;
      }
      topLevelNodes.forEach((el) => {
        el.remove();
      });
    });
  }, [editor]);

  if (!open) return null;

  return createPortal(
    <div
      ref={(node) => {
        refs.setFloating(node);
        bubbleRef.current = node;
      }}
      style={{position: strategy, top: y ?? 0, left: x ?? 0}}
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
          onMouseDown={(e)=>e.preventDefault()} 
          onClick={() => onInlineFormat("bold")}
        >
          B
        </button>
        <button 
          type="button" 
          aria-pressed={formatState.italic} 
          aria-label="斜体"
          className={`bubble-button${formatState.italic ? " is-active" : ""}`} 
          onMouseDown={(e)=>e.preventDefault()} 
          onClick={() => onInlineFormat("italic")}
        >
          I
        </button>
        <button 
          type="button" 
          aria-pressed={formatState.underline} 
          aria-label="下划线"
          className={`bubble-button${formatState.underline ? " is-active" : ""}`} 
          onMouseDown={(e)=>e.preventDefault()} 
          onClick={() => onInlineFormat("underline")}
        >
          U
        </button>
        <button 
          type="button" 
          aria-pressed={formatState.strikethrough} 
          aria-label="删除线"
          className={`bubble-button${formatState.strikethrough ? " is-active" : ""}`} 
          onMouseDown={(e)=>e.preventDefault()} 
          onClick={() => onInlineFormat("strikethrough")}
        >
          S
        </button>
        <button 
          type="button" 
          aria-pressed={formatState.code} 
          aria-label="行内代码"
          className={`bubble-button${formatState.code ? " is-active" : ""}`} 
          onMouseDown={(e)=>e.preventDefault()} 
          onClick={() => onInlineFormat("code")}
        >
          {"</>"}
        </button>
        <button 
          type="button" 
          aria-pressed={formatState.subscript} 
          aria-label="下标"
          className={`bubble-button${formatState.subscript ? " is-active" : ""}`} 
          onMouseDown={(e)=>e.preventDefault()} 
          onClick={() => onInlineFormat("subscript")}
        >
          X₂
        </button>
        <button 
          type="button" 
          aria-pressed={formatState.superscript} 
          aria-label="上标"
          className={`bubble-button${formatState.superscript ? " is-active" : ""}`} 
          onMouseDown={(e)=>e.preventDefault()} 
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
          onMouseDown={(e)=>e.preventDefault()} 
          onClick={onCopy}
        >
          复制
        </button>
        <button 
          type="button" 
          className="bubble-button" 
          aria-label="删除所选节点"
          onMouseDown={(e)=>e.preventDefault()} 
          onClick={onDelete}
        >
          删除
        </button>
      </fieldset>
    </div>,
    containerEl ?? document.body,
  );
}


