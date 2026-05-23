/**
 * Button primitive.
 *
 * No `class-variance-authority` dependency — variants/sizes are resolved via
 * plain lookup objects so the bundle stays minimal. Forwards refs so it
 * composes cleanly with `<form>` submits, focus handlers, and Radix slots
 * (when added later).
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

type Variant = 'default' | 'destructive' | 'outline' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

const VARIANT: Record<Variant, string> = {
  default: 'bg-tilt-green text-background hover:bg-tilt-green/90 border border-transparent',
  destructive: 'bg-tilt-red text-background hover:bg-tilt-red/90 border border-transparent',
  outline: 'border border-border bg-transparent text-foreground hover:bg-muted/60',
  ghost: 'bg-transparent text-foreground hover:bg-muted/60 border border-transparent',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4',
  lg: 'h-10 px-6',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'md', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(BASE, VARIANT[variant], SIZE[size], className)}
      {...rest}
    />
  );
});
