import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import {
  $createNodeSelection,
  $createRangeSelection,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $isElementNode,
  $setSelection,
  type LexicalEditor,
} from "lexical";
import {useCallback, useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";

type OverlayInfo = {
  key: string;
  element: HTMLElement;
  top: number;
  left: number;
};

export default function NodeActionIconPlugin() {
  const [editor] = useLexicalComposerContext();
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);
  const [overlayInfo, setOverlayInfo] = useState<OverlayInfo | null>(null);
  const highlightedElRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // 解析容器
  const resolveContainer = useCallback(() => {
    const root = editor.getRootElement();
    if (!root) return null;
    return (root.closest('.editor-container') as HTMLElement | null) || root.parentElement;
  }, [editor]);

  useEffect(() => {
    const container = resolveContainer();
    setContainerEl(container);
  }, [resolveContainer]);

  const rightOffset = 12;

  const computeOverlay = useCallback(
    (key: string): OverlayInfo | null => {
      const container = resolveContainer();
      if (!container) return null;
      const element = editor.getElementByKey(key) as HTMLElement | null;
      if (!element) return null;

      const containerRect = container.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const top = rect.top - containerRect.top + rect.height / 2;
      const left = containerRect.width - rightOffset;

      return { key, element, top, left };
    },
    [editor, resolveContainer, rightOffset],
  );

  const clearRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // 在容器级监听 pointermove，解析悬浮的顶级节点
  useEffect(() => {
    const root = editor.getRootElement();
    const container = resolveContainer();
    if (!root || !container) return;

    const onPointerMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (target.closest('.node-action-button')) return; // 在按钮上保持当前 hover

      clearRaf();
      rafRef.current = requestAnimationFrame(() => {
        if (!container.contains(target)) {
          setOverlayInfo(null);
          return;
        }
        if (!root.contains(target)) return;

        editor.read(() => {
          const node = $getNearestNodeFromDOMNode(target as Node);
          if (!node) {
            setOverlayInfo(null);
            return;
          }
          const topNode = node.getTopLevelElementOrThrow();
          const topKey = topNode.getKey?.();
          if (!topKey) {
            setOverlayInfo(null);
            return;
          }
          const topElement = editor.getElementByKey(topKey) as HTMLElement | null;
          if (!topElement || !$isElementNode(topNode)) {
            setOverlayInfo(null);
            return;
          }

          setOverlayInfo((prev) => {
            if (prev && prev.key === topKey) {
              return computeOverlay(topKey) ?? null;
            }
            const next = computeOverlay(topKey);
            return next;
          });
        });
      });
    };

    const onPointerLeave = (e: PointerEvent) => {
      const next = e.relatedTarget as Element | null;
      if (next && (container.contains(next) || next.closest('.node-action-button'))) return;
      setOverlayInfo(null);
    };

    container.addEventListener('pointermove', onPointerMove, { passive: true });
    container.addEventListener('pointerleave', onPointerLeave, { passive: true });
    return () => {
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
      clearRaf();
    };
  }, [editor, clearRaf, computeOverlay, resolveContainer]);

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
      clearRaf();
    };
  }, [clearHighlight, clearRaf]);

  useEffect(() => {
    if (!overlayInfo) {
      clearHighlight();
    }
  }, [overlayInfo, clearHighlight]);

  const applyHighlight = useCallback(
    (el: HTMLElement) => {
      if (highlightedElRef.current === el) return;
      clearHighlight();
      el.classList.add('is-node-hovered');
      highlightedElRef.current = el;
    },
    [clearHighlight],
  );

  const selectNode = useCallback((theEditor: LexicalEditor, key: string) => {
    theEditor.focus();
    theEditor.update(() => {
      const node = $getNodeByKey(key);
      if (!node) return;
      const top = node.getTopLevelElementOrThrow();

      if ($isElementNode(top)) {
        const textNodes = top.getAllTextNodes();
        const start = textNodes[0];
        const end = textNodes[textNodes.length - 1];
        if (start && end) {
          const selection = $createRangeSelection();
          selection.setTextNodeRange(start, 0, end, end.getTextContentSize());
          $setSelection(selection);
          return;
        }
      }

      const nodeSelection = $createNodeSelection();
      nodeSelection.add(top.getKey());
      $setSelection(nodeSelection);
    });
  }, []);

  // 当容器滚动或尺寸变化时更新浮层位置
  useEffect(() => {
    if (!overlayInfo) return;
    const container = resolveContainer();
    if (!container) return;

    const updatePosition = () => {
      setOverlayInfo((prev) => {
        if (!prev) return null;
        return computeOverlay(prev.key);
      });
    };

    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(container);
    resizeObserver.observe(overlayInfo.element);
    container.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition, { passive: true });

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    };
  }, [overlayInfo, computeOverlay, resolveContainer]);

  if (!overlayInfo || !containerEl) return null;

  return createPortal(
    <button
      type="button"
      className="node-action-button"
      aria-label="选择该节点文本"
      aria-pressed="false"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        transform: `translate(${overlayInfo.left}px, ${overlayInfo.top}px) translateY(-50%)`,
      }}
      onMouseDown={(e) => e.preventDefault()}
      onPointerEnter={() => applyHighlight(overlayInfo.element)}
      onPointerLeave={() => clearHighlight()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          clearHighlight();
          selectNode(editor, overlayInfo.key);
        }
      }}
      onClick={() => {
        clearHighlight();
        selectNode(editor, overlayInfo.key);
      }}
    >
      ✎
    </button>,
    containerEl,
  );
}
