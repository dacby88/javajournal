import type { ReactNode } from 'react';

export function formatTradeCurrency(value: number | null | undefined): string {
  if (value === undefined || value === null) return '-';
  return value >= 0 ? `$${value.toFixed(2)}` : `-$${Math.abs(value).toFixed(2)}`;
}

/** Blank when any open leg has no quote, so a partial mark is not a trade P&L. */
export function sumOpenPositionPnl(values: Array<number | null | undefined>): number | null {
  if (values.length === 0 || values.some((value) => value == null)) return null;
  return values.reduce<number>((sum, value) => sum + (value as number), 0);
}

export function OpenTradeNetPnlFigures({
  isOpen,
  pnl,
  netCash,
}: {
  isOpen: boolean;
  pnl: number | null;
  netCash: number;
}): ReactNode {
  if (isOpen && pnl == null) {
    return (
      <>
        <div className={`text-2xl font-bold ${netCash >= 0 ? 'text-profit' : 'text-loss'}`}>
          {formatTradeCurrency(netCash)}
        </div>
        <div className="text-sm text-muted-foreground">Net Cash</div>
      </>
    );
  }

  return (
    <>
      <div className={`text-2xl font-bold ${(pnl || 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
        {pnl == null ? '-' : formatTradeCurrency(pnl)}
      </div>
      {isOpen && (
        <div className={`text-sm ${netCash >= 0 ? 'text-profit' : 'text-loss'}`}>
          Net Cash: {formatTradeCurrency(netCash)}
        </div>
      )}
    </>
  );
}
