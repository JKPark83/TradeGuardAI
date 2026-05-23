'use client';

/**
 * Dialog primitive built on the native `<dialog>` element.
 *
 * Why native: we avoid Radix until a real reason emerges (e.g. nested focus
 * traps, multi-portal stacking). The native element ships modal focus
 * containment, ESC-to-close, and `inert`-equivalent semantics for free in
 * modern browsers — enough for v1 confirmation modals (e.g. data deletion).
 *
 * `DialogTrigger` is a thin button wrapper that flips an external `open`
 * boolean via the caller's `onOpen` callback. The parent owns dialog state.
 */

import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils/cn';

interface DialogProps {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, children, className }: DialogProps): ReactNode {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={cn(
        'rounded-lg border border-border bg-background text-foreground',
        'p-0 backdrop:bg-black/70 backdrop:backdrop-blur-sm',
        'max-w-lg w-[90vw] shadow-xl',
        className,
      )}
    >
      {children}
    </dialog>
  );
}

interface DialogTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  onOpen: () => void;
}

export function DialogTrigger({
  onOpen,
  onClick,
  className,
  children,
  ...rest
}: DialogTriggerProps): ReactNode {
  return (
    <button
      type="button"
      onClick={(e) => {
        onClick?.(e);
        onOpen();
      }}
      className={cn('inline-flex items-center', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function DialogContent({ className, ...rest }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('flex flex-col gap-4 p-6', className)} {...rest} />;
}

export function DialogHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('flex flex-col gap-1.5', className)} {...rest} />;
}

export function DialogTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>): ReactNode {
  return <h2 className={cn('text-base font-semibold tracking-tight', className)} {...rest} />;
}

export function DialogFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('flex items-center justify-end gap-2 pt-2', className)} {...rest} />;
}
