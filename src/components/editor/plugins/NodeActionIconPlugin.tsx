import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import {
  $createRangeSelection,
  $getNearestNodeFromDOMNode,
  $isElementNode,
  $setSelection,
  type LexicalEditor,
} from "lexical";
import {useCallback, useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";

type HoverInfo = {
  key: string;
  rect: DOMRect;
  element: HTMLElement;
};

export default function NodeActionIconPlugin() {
  const [editor] = useLexicalComposerContext();
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const highlightedElRef = useRef<HTMLElement | null>(null);

  // 解析容器
  useEffect(() => {
    const root = editor.getRootElement();
    const container = (root?.closest('.editor-container') as HTMLElement | null) || (root?.parentElement ?? null);
    setContainerEl(container);
  }, [editor]);

  // 在容器级监听 pointermove，解析悬浮的顶级节点
  useEffect(() => {
    const root = editor.getRootElement();
    const container = (root?.closest('.editor-container') as HTMLElement | null) || (root?.parentElement ?? null);
    if (!root || !container) return;

    let rafId: number | null = null;

    const onPointerMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (target.closest('.node-action-button')) return; // 在按钮上保持当前 hover

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!container.contains(target)) {
          setHoverInfo(null);
          return;
        }
        if (!root.contains(target)) return;

        editor.read(() => {
          const node = $getNearestNodeFromDOMNode(target as Node);
          if (!node) {
            setHoverInfo(null);
            return;
          }
          const top = node.getTopLevelElementOrThrow();
          const topKey = top.getKey?.();
          if (!topKey) {
            setHoverInfo(null);
            return;
          }
          const el = editor.getElementByKey(topKey) as HTMLElement | null;
          const rect = el?.getBoundingClientRect() ?? null;
          let hasText = false;
          if ($isElementNode(top)) {
            const texts = top.getAllTextNodes();
            hasText = texts.some((t) => t.getTextContentSize() > 0);
          }
          if (el && rect && hasText) {
            setHoverInfo((prev) => {
              if (prev && prev.key === topKey) {
                const sameTop = Math.abs(prev.rect.top - rect.top) < 0.5;
                const sameHeight = Math.abs(prev.rect.height - rect.height) < 0.5;
                if (sameTop && sameHeight) return prev;
              }
              return { key: topKey, rect, element: el };
            });
            return;
          }
          setHoverInfo(null);
        });
      });
    };

    const onPointerLeave = (e: PointerEvent) => {
      const next = e.relatedTarget as Element | null;
      if (next && (container.contains(next) || next.closest('.node-action-button'))) return;
      setHoverInfo(null);
    };

    container.addEventListener('pointermove', onPointerMove, { passive: true });
    container.addEventListener('pointerleave', onPointerLeave, { passive: true });
    return () => {
      container.removeEventListener('pointermove', onPointerMove, { passive: true } as EventListenerOptions);
      container.removeEventListener('pointerleave', onPointerLeave, { passive: true } as EventListenerOptions);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [editor]);

  const clearHighlight = useCallback(() => {
    const el = highlightedElRef.current;
    if (el) {
      el.classList.remove('is-node-hovered');
      highlightedElRef.current = null;
    }
  }, []);

  // 组件卸载时移除高亮
  useEffect(() => {
    return () => {
      clearHighlight();
    };
  }, [clearHighlight]);

  const applyHighlight = useCallback((el: HTMLElement) => {
    if (highlightedElRef.current === el) return;
    clearHighlight();
    el.classList.add('is-node-hovered');
    highlightedElRef.current = el;
  }, [clearHighlight]);

  const selectNodeText = (theEditor: LexicalEditor, key: string) => {
    theEditor.update(() => {
      const element = theEditor.getElementByKey(key);
      if (!element) return;

      // 找到对应的 Lexical 节点并创建文本范围选择
      const domNode = element as Node;
      const lexicalNode = $getNearestNodeFromDOMNode(domNode);
      if (!lexicalNode) return;
      const top = lexicalNode.getTopLevelElementOrThrow();
      
      if ($isElementNode(top)) {
        const all = top.getAllTextNodes();
        const start = all[0];
        const end = all[all.length - 1];
        if (start && end) {
          const selection = $createRangeSelection();
          selection.setTextNodeRange(start, 0, end, end.getTextContentSize());
          $setSelection(selection);
        }
      }
    });
  };

  if (!hoverInfo || !containerEl) return null;

  const containerRect = containerEl.getBoundingClientRect();
  const top = hoverInfo.rect.top - containerRect.top + hoverInfo.rect.height / 2;
  const rightOffset = 12; // 距离容器右侧的偏移
  const left = containerRect.width - rightOffset;

  return createPortal(
    <button
      type="button"
      className="node-action-button"
      aria-label="选择该节点文本"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        transform: `translate(${left}px, ${top}px) translateY(-50%)`,
      }}
      onMouseDown={(e) => e.preventDefault()}
      onPointerEnter={() => applyHighlight(hoverInfo.element)}
      onPointerLeave={() => clearHighlight()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          clearHighlight();
          selectNodeText(editor, hoverInfo.key);
        }
      }}
      onClick={() => {
        clearHighlight();
        selectNodeText(editor, hoverInfo.key);
      }}
    >
      ✎
    </button>,
    containerEl,
  );
}


