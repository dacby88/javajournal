import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(value: string | Date | undefined | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateTime(value: string | Date | undefined | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

export function formatTime(value: string | Date | undefined | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${min}:${s}`;
}

/** Insert wrap points after /, +, and > so long trade names can break without widening the table. */
export function wrapTradeDescription(text: string): string {
  return text.replace(/([>/+])/g, '$1\u200B');
}

/**
 * Read an account selection from URL params. Supports `account_id` (single) and
 * `account_ids` (comma-separated), returning a de-duplicated list of ids.
 */
export function parseAccountIdsParam(params: URLSearchParams): number[] {
  const ids: number[] = [];
  const single = params.get('account_id');
  if (single) {
    const parsed = parseInt(single, 10);
    if (!Number.isNaN(parsed)) ids.push(parsed);
  }
  const multi = params.get('account_ids');
  if (multi) {
    multi.split(',').forEach((part) => {
      const parsed = parseInt(part.trim(), 10);
      if (!Number.isNaN(parsed)) ids.push(parsed);
    });
  }
  return Array.from(new Set(ids));
}
