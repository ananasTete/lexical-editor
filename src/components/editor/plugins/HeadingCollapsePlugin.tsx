import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import {HeadingNode} from "@lexical/rich-text";
import type { LexicalEditor } from "lexical";
import { $getNearestNodeFromDOMNode, $getRoot, createCommand, type LexicalCommand } from "lexical";
import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import {createPortal} from "react-dom";
import { $createCollapsedStateNode, $getCollapsedStateNode } from "./CollapsedStateNode";

type HeadingInfo = {
  key: string;
  level: number; // 1..6
  rect: DOMRect;
  element: HTMLElement;
};

// 通过命令使折叠/展开被 History 插件记录
export type ToggleHeadingCollapsePayload = { key: string };
export const TOGGLE_HEADING_COLLAPSE_COMMAND: LexicalCommand<ToggleHeadingCollapsePayload> = createCommand('TOGGLE_HEADING_COLLAPSE_COMMAND');

export default function HeadingCollapsePlugin() {
  const [editor] = useLexicalComposerContext();
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);

  // 当前悬浮的标题信息
  const [hoverHeading, setHoverHeading] = useState<HeadingInfo | null>(null);

  // 折叠状态：记录被折叠的标题 key 集合
  const collapsedHeadingKeysRef = useRef<Set<string>>(new Set());

  // 移除 WeakSet 逻辑，统一用 dataset 标记进行恢复

  // 解析容器（用于挂载与相对定位）
  useEffect(() => {
    const root = editor.getRootElement();
    const container = (root?.closest('.editor-container') as HTMLElement | null) || (root?.parentElement ?? null);
    setContainerEl(container);
  }, [editor]);

  // 根据悬浮目标更新 hoverHeading（在容器级别监听，避免移入按钮时闪烁）
  useEffect(() => {
    const root = editor.getRootElement();
    const container = (root?.closest('.editor-container') as HTMLElement | null) || (root?.parentElement ?? null);
    if (!root || !container) return;

    let rafId: number | null = null;

    const handlePointerMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      // 鼠标在按钮上：保持现有 hover 状态
      if (target.closest('.heading-collapse-button')) return;

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        // 移出容器：清空 hover
        if (!container.contains(target)) {
          setHoverHeading(null);
          return;
        }
        // 仅当目标在编辑器 root 内时才解析标题；在容器但不在 root 时保持现状，避免闪烁
        if (!root.contains(target)) return;

        editor.read(() => {
          const node = $getNearestNodeFromDOMNode(target);
          let heading: HeadingNode | null = null;
          if (node) {
            const top = node.getTopLevelElementOrThrow();
            if (top?.getType?.() === 'heading') heading = top as HeadingNode;
          }
          if (heading) {
            const key = heading.getKey();
            const tag = heading.getTag();
            const parsed = Number(tag.replace('h', ''));
            const level = Number.isNaN(parsed) ? 0 : parsed;
            const el = editor.getElementByKey(key) as HTMLElement | null;
            const rect = el?.getBoundingClientRect() ?? null;
            if (el && rect) {
              setHoverHeading({ key, level, rect, element: el });
              return;
            }
          }
          setHoverHeading(null);
        });
      });
    };

    const handlePointerLeave = (e: PointerEvent) => {
      const next = e.relatedTarget as Element | null;
      // 若进入了按钮，也视为仍在容器交互区域，保持显示
      if (next && (container.contains(next) || next.closest('.heading-collapse-button'))) return;
      setHoverHeading(null);
    };

    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [editor]);

  // 监听编辑器更新：从编辑器状态节点读取折叠集合，并重应用
  useEffect(() => {
    return editor.registerUpdateListener(({editorState}) => {
      editorState.read(() => {
        const stateNode = $getCollapsedStateNode();
        const keys = stateNode ? stateNode.getKeys() : new Set<string>();
        collapsedHeadingKeysRef.current = keys;
      });
      reapplyAllCollapses(editor, collapsedHeadingKeysRef.current);
    });
  }, [editor]);

  // 注册命令：在挂载时注册一次
  useEffect(() => {
    return registerToggleCollapseCommand(editor, collapsedHeadingKeysRef, () => {
      setHoverHeading((prev) => (prev ? { ...prev } : prev));
    });
  }, [editor]);

  // 在删除/新增标题节点时重应用
  useEffect(() => {
    return editor.registerMutationListener(HeadingNode, () => {
      reapplyAllCollapses(editor, collapsedHeadingKeysRef.current);
    });
  }, [editor]);

  // 组件卸载时恢复被隐藏元素
  useEffect(() => {
    return () => {
      const root = editor.getRootElement();
      if (root) {
        tryRestoreElements(root);
      }
    };
  }, [editor]);

  const toggleCollapse = () => {
    const h = hoverHeading;
    if (!h) return;
    // 通过命令触发离散更新，使其纳入 History
    editor.dispatchCommand(TOGGLE_HEADING_COLLAPSE_COMMAND, { key: h.key });
  };

  // UI 与定位（采用 DraggableBlockPlugin 的简单方式）
  if (!hoverHeading || !containerEl) return null;

  const containerRect = containerEl.getBoundingClientRect();
  const top = hoverHeading.rect.top - containerRect.top + hoverHeading.rect.height / 2;
  const left = hoverHeading.rect.left - containerRect.left;

  const isCollapsed = collapsedHeadingKeysRef.current.has(hoverHeading.key);

  return createPortal(
    <button
      type="button"
      className={`heading-collapse-button${isCollapsed ? ' is-collapsed' : ''}`}
      aria-label={isCollapsed ? '展开标题内容' : '折叠标题内容'}
      aria-pressed={isCollapsed}
      style={{ 
        position: 'absolute',
        top: 0,
        left: 0,
        // 使用 transform 定位，性能更好（不触发重排）
        transform: `translate(${left - 20}px, ${top}px) translateY(-50%)`,
        zIndex: 10000
      }}
      onMouseDown={(e) => e.preventDefault()}
      onPointerLeave={(e) => {
        const container = containerEl;
        const next = e.relatedTarget as Element | null;
        // 若移动到容器内，保持显示
        if (next && container.contains(next)) return;
        setHoverHeading(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleCollapse();
        }
      }}
      onClick={toggleCollapse}
    >
      {isCollapsed ? '▸' : '▾'}
    </button>,
    containerEl,
  );
}

// 重新计算并应用所有折叠状态
function reapplyAllCollapses(
  editor: LexicalEditor,
  collapsedKeys: Set<string>,
) {
  const root = editor.getRootElement();
  if (!root) return;

  // 恢复之前隐藏的元素
  tryRestoreElements(root);

  // 应用折叠：按文档顺序处理，隐藏从该标题到下一个同级或更高的标题之前的兄弟元素
  const children = Array.from(root.children) as HTMLElement[];
  const toHide = new Set<HTMLElement>();
  const validCollapsedKeys = new Set<string>();

  editor.read(() => {
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      const node = $getNearestNodeFromDOMNode(el);
      if (!node) continue;
      const top = node.getTopLevelElementOrThrow();
      if (!top || top?.getType?.() !== 'heading') continue;
      const heading = top as unknown as HeadingNode;
      const key = heading.getKey();
      if (!collapsedKeys.has(key)) continue;
      validCollapsedKeys.add(key);
      const level = Number(heading.getTag().replace('h', '')) || 0;

      // 向后隐藏，直到遇到 level <= 当前的标题或到末尾
      for (let j = i + 1; j < children.length; j++) {
        const sib = children[j];
        const sibNode = $getNearestNodeFromDOMNode(sib);
        if (sibNode) {
          const sibTop = sibNode.getTopLevelElementOrThrow();
          if (sibTop?.getType?.() === 'heading') {
            const sibHeading = sibTop as unknown as HeadingNode;
            const sibLevel = Number(sibHeading.getTag().replace('h', '')) || 0;
          if (sibLevel <= level) break;
          }
        }
        toHide.add(sib);
      }
    }
  });

  // 清理无效的折叠 key（对应 heading 不存在或类型不符）
  for (const key of Array.from(collapsedKeys)) {
    if (!validCollapsedKeys.has(key)) {
      collapsedKeys.delete(key);
    }
  }

  for (const el of toHide) {
    hideElement(el);
  }
}

function hideElement(el: HTMLElement) {
  if (!(el.dataset && Object.hasOwn(el.dataset, 'origDisplay'))) {
    el.dataset.origDisplay = el.style.display || '';
  }
  el.style.display = 'none';
}

function tryRestoreElements(root: HTMLElement) {
  // 直接遍历 root.children 并恢复带有数据标记的元素。
  const children = Array.from(root.children) as HTMLElement[];
  for (const el of children) {
    if (el.dataset && Object.hasOwn(el.dataset, 'origDisplay')) {
      el.style.display = el.dataset.origDisplay || '';
      delete el.dataset.origDisplay;
    }
  }
}

// 将命令注册到编辑器：在首次挂载时注册一次
// 注册命令：在编辑器状态中切换 CollapsedStateNode 的 keys
function registerToggleCollapseCommand(
  editor: LexicalEditor,
  collapsedKeysRef: MutableRefObject<Set<string>>,
  onStateChanged: () => void,
) {
  return editor.registerCommand(
    TOGGLE_HEADING_COLLAPSE_COMMAND,
    (payload) => {
      editor.update(() => {
        let stateNode = $getCollapsedStateNode();
        if (!stateNode) {
          stateNode = $createCollapsedStateNode();
          $getRoot().append(stateNode);
        }
        stateNode.toggle(payload.key);
      });

      // 同步外部缓存并重新应用
      editor.getEditorState().read(() => {
        const stateNode = $getCollapsedStateNode();
        const keys = stateNode ? stateNode.getKeys() : new Set<string>();
        collapsedKeysRef.current = keys;
      });
      reapplyAllCollapses(editor, collapsedKeysRef.current);
      onStateChanged();
      return true;
    },
    0,
  );
}

