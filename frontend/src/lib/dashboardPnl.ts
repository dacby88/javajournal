export interface ChartTradePnl {
  is_open?: boolean;
  open_pnl?: number | null;
  net_pnl?: number | null;
  tags?: unknown[] | null;
}

/** Closed trades use stored net P&L. Open trades use the live mark, or nothing when it is missing. */
export function chartTradePnl(trade: ChartTradePnl): number | null {
  if (trade.is_open) {
    return trade.open_pnl != null ? trade.open_pnl : null;
  }
  return trade.net_pnl ?? 0;
}

export function untaggedTagBucket(trades: ChartTradePnl[]) {
  const values = trades
    .filter((trade) => !trade.tags || trade.tags.length === 0)
    .map(chartTradePnl)
    .filter((pnl): pnl is number => pnl != null);
  if (values.length === 0) return [];
  const pnl = values.reduce((sum, value) => sum + value, 0);
  return [{
    tag: '(untagged)',
    pnl,
    count: values.length,
    color: pnl >= 0 ? '#22c55e' : '#ef4444',
  }];
}
