/**
 * Table primitives — thin semantic wrappers around native table elements.
 *
 * Naming follows shadcn/ui conventions:
 *   - `TableHeader` = `<thead>`
 *   - `TableHead`   = `<th>` (cell)
 *   - `TableBody`   = `<tbody>`
 *   - `TableRow`    = `<tr>`
 *   - `TableCell`   = `<td>`
 *
 * Wrapping in a horizontally scrollable container is intentional — narrow
 * viewports preserve the terminal-style fixed-width layout instead of
 * reflowing rows.
 */

import {
  forwardRef,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils/cn';

export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(function Table(
  { className, ...rest },
  ref,
) {
  return (
    <div className="w-full overflow-x-auto">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...rest} />
    </div>
  );
});

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(function TableHeader({ className, ...rest }, ref) {
  return <thead ref={ref} className={cn('border-b border-border', className)} {...rest} />;
});

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(function TableBody({ className, ...rest }, ref) {
  return <tbody ref={ref} className={cn('divide-y divide-border', className)} {...rest} />;
});

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  function TableRow({ className, ...rest }, ref) {
    return (
      <tr ref={ref} className={cn('hover:bg-muted/40 transition-colors', className)} {...rest} />
    );
  },
);

export const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  function TableHead({ className, ...rest }, ref) {
    return (
      <th
        ref={ref}
        scope="col"
        className={cn(
          'h-9 px-3 text-left align-middle text-xs font-medium uppercase tracking-wider text-muted-foreground',
          className,
        )}
        {...rest}
      />
    );
  },
);

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  function TableCell({ className, ...rest }, ref) {
    return (
      <td ref={ref} className={cn('px-3 py-2 align-middle text-foreground', className)} {...rest} />
    );
  },
);
