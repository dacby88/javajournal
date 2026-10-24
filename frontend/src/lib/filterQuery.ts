const numericKeys = new Set([
  'account_id',
  'trade_id',
  'limit',
  'offset',
  'duration_min_minutes',
  'duration_max_minutes',
]);

const numericArrayKeys = new Set(['account_ids', 'tag_ids']);

export function filtersToSearchParams(filters: object): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

export function mergeFiltersFromSearchParams<T extends object>(
  base: T,
  params: URLSearchParams,
): T {
  const merged = { ...base } as Record<string, unknown>;
  params.forEach((value, key) => {
    if (numericArrayKeys.has(key)) {
      const values = value
        .split(',')
        .map(part => Number.parseInt(part.trim(), 10))
        .filter(number => Number.isFinite(number));
      merged[key] = Array.from(new Set(values));
    } else if (numericKeys.has(key)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) merged[key] = parsed;
    } else if (key === 'matched' && (value === 'true' || value === 'false')) {
      merged[key] = typeof merged[key] === 'string' ? value : value === 'true';
    } else {
      merged[key] = value;
    }
  });
  return merged as T;
}
