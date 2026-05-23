/**
 * Card primitives — passive structural wrappers.
 *
 * Intentionally div-only (no semantic `<section>` / `<article>` here) so
 * callers can decide the outer landmark. Use heading levels inside CardTitle
 * by passing `as` only if needed in the future.
 */

import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

type DivProps = HTMLAttributes<HTMLDivElement>;

export const Card = forwardRef<HTMLDivElement, DivProps>(function Card(
  { className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-muted/20 shadow-sm', className)}
      {...rest}
    />
  );
});

export const CardHeader = forwardRef<HTMLDivElement, DivProps>(function CardHeader(
  { className, ...rest },
  ref,
) {
  return <div ref={ref} className={cn('flex flex-col gap-1.5 p-4 lg:p-6', className)} {...rest} />;
});

export const CardTitle = forwardRef<HTMLDivElement, DivProps>(function CardTitle(
  { className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'text-base font-semibold leading-none tracking-tight text-foreground',
        className,
      )}
      {...rest}
    />
  );
});

export const CardDescription = forwardRef<HTMLDivElement, DivProps>(function CardDescription(
  { className, ...rest },
  ref,
) {
  return <div ref={ref} className={cn('text-xs text-muted-foreground', className)} {...rest} />;
});

export const CardContent = forwardRef<HTMLDivElement, DivProps>(function CardContent(
  { className, ...rest },
  ref,
) {
  return <div ref={ref} className={cn('p-4 pt-0 lg:p-6 lg:pt-0', className)} {...rest} />;
});

export const CardFooter = forwardRef<HTMLDivElement, DivProps>(function CardFooter(
  { className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('flex items-center gap-2 p-4 pt-0 lg:p-6 lg:pt-0', className)}
      {...rest}
    />
  );
});
