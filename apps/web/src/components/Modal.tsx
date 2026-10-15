/** 模态容器：按单一职责统一焦点、键盘与关闭行为，内容和业务操作由调用方提供。 */
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** 对局提供暂停与停靠区域；独立使用的弹窗仍可在原位置渲染。 */
export const ModalInteractionContext = createContext<{ onOpen: () => void; container: HTMLElement | null } | null>(null);

interface Props {
  label: string;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  backdropClassName?: string;
  closeOnBackdrop?: boolean;
}

const openModals: HTMLElement[] = [];
const inertLayers = new WeakMap<HTMLElement, { count: number; previous: boolean }>();
const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export default function Modal({ label, onClose, children, className = '', backdropClassName = '', closeOnBackdrop = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const interaction = useContext(ModalInteractionContext);
  const container = interaction?.container;
  const onOpen = interaction?.onOpen;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onOpen?.();
    openModals.push(dialog);
    // 按层计数，避免关闭底层弹窗时提前解除另一层的背景输入隔离。
    const background: HTMLElement[] = [];
    for (let branch: HTMLElement = dialog; branch.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
        const layer = inertLayers.get(sibling) ?? { count: 0, previous: sibling.inert };
        layer.count++; inertLayers.set(sibling, layer); sibling.inert = true; background.push(sibling);
      }
      if (branch.parentElement === container || branch.parentElement === document.body) break;
    }
    const isTop = () => openModals.at(-1) === dialog && !document.querySelector('dialog[open]');
    const controls = () => [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter(element => {
      if (element.tabIndex < 0 || element.closest('[hidden], [inert], [aria-disabled="true"]')) return false;
      for (let node: HTMLElement | null = element; node && node !== dialog; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    });
    const focusFirst = () => (controls()[0] ?? dialog).focus();
    focusFirst();
    dialog.scrollIntoView({ block: 'nearest' });
    const handleFocus = (event: FocusEvent) => {
      if (isTop() && !dialog.contains(event.target as Node)) focusFirst();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (!isTop()) return;
      // 模态层消费 Escape，避免一并关闭底层弹窗或触发牌桌快捷键。
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) closeRef.current?.();
      } else if (event.key === 'Tab') {
        const items = controls();
        const first = items[0] ?? dialog; const last = items.at(-1) ?? dialog;
        if (!items.length || !dialog.contains(document.activeElement) ||
          (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    document.addEventListener('focusin', handleFocus);
    return () => {
      const wasTop = openModals.at(-1) === dialog;
      openModals.splice(openModals.indexOf(dialog), 1);
      document.removeEventListener('keydown', handleKey, true);
      document.removeEventListener('focusin', handleFocus);
      for (const element of background) {
        const layer = inertLayers.get(element)!;
        if (--layer.count === 0) { element.inert = layer.previous; inertLayers.delete(element); }
      }
      if (wasTop && previous?.isConnected) previous.focus();
    };
  }, [container, onOpen]);

  const content = (
    <div className={`modal-backdrop ${backdropClassName}`} data-dialog-dock="side" onClick={event => {
      if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
    }}>
      <div ref={ref} className={className} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
  return container ? createPortal(content, container) : content;
}
