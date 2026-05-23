/**
 * Form primitives — styled native inputs.
 *
 * No `react-hook-form` integration yet; callers manage state themselves.
 * When form complexity grows (>1 multi-step flow), upgrade to RHF + zodResolver
 * and re-export adapters from this file to keep the import surface stable.
 */

import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils/cn';

const INPUT_BASE =
  'flex w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-sm ' +
  'text-foreground placeholder:text-muted-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  function Label({ className, ...rest }, ref) {
    return (
      <label
        ref={ref}
        className={cn(
          'text-xs font-medium uppercase tracking-wider text-muted-foreground',
          className,
        )}
        {...rest}
      />
    );
  },
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type = 'text', ...rest }, ref) {
    return <input ref={ref} type={type} className={cn(INPUT_BASE, 'h-9', className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(INPUT_BASE, 'h-9 appearance-none pr-8', className)} {...rest}>
        {children}
      </select>
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(INPUT_BASE, 'min-h-[80px]', className)}
      {...rest}
    />
  );
});
