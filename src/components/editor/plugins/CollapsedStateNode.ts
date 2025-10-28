import type { EditorConfig, NodeKey, SerializedElementNode } from "lexical";
import { $getRoot, ElementNode } from "lexical";

export type SerializedCollapsedStateNode = SerializedElementNode & {
  type: 'collapsed-state';
  version: 1;
  keys: string[];
};

export class CollapsedStateNode extends ElementNode {
  __keys: Set<string>;

  static getType(): string {
    return 'collapsed-state';
  }

  static clone(node: CollapsedStateNode): CollapsedStateNode {
    const cloned = new CollapsedStateNode(node.__key);
    cloned.__keys = new Set(node.__keys);
    return cloned;
  }

  constructor(key?: NodeKey) {
    super(key);
    this.__keys = new Set();
  }

  // 不需要在编辑器中显示
  createDOM(_config: EditorConfig): HTMLElement {
    const el = document.createElement('span');
    el.setAttribute('data-lexical-collapsed-state', 'true');
    el.style.display = 'none';
    el.ariaHidden = 'true';
    el.contentEditable = 'false';
    return el;
  }

  updateDOM(): boolean {
    return false;
  }

  isIsolated(): boolean {
    return true;
  }

  canBeEmpty(): boolean {
    return true;
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  excludeFromCopy(): boolean {
    return true;
  }

  exportJSON(): SerializedCollapsedStateNode {
    return {
      ...super.exportJSON(),
      type: 'collapsed-state',
      version: 1,
      keys: Array.from(this.__keys),
    };
  }

  static importJSON(json: SerializedCollapsedStateNode): CollapsedStateNode {
    const node = new CollapsedStateNode();
    node.__keys = new Set(json.keys ?? []);
    return node;
  }

  getKeys(): Set<string> {
    return new Set(this.getLatest().__keys);
  }

  setKeys(keys: Iterable<string>): void {
    const self = this.getWritable();
    self.__keys = new Set(keys);
  }

  toggle(key: string): void {
    const self = this.getWritable();
    if (self.__keys.has(key)) {
      self.__keys.delete(key);
    } else {
      self.__keys.add(key);
    }
  }
}

export function $createCollapsedStateNode(): CollapsedStateNode {
  return new CollapsedStateNode();
}

export function $getCollapsedStateNode(): CollapsedStateNode | null {
  const root = $getRoot();
  const children = root.getChildren();
  for (const child of children) {
    if (child.getType() === CollapsedStateNode.getType()) {
      return child as CollapsedStateNode;
    }
  }
  return null;
}


