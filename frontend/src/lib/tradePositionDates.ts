import type { Execution } from '@/types';

export interface PositionExecutionDates {
  openDate: string | null;
  closeDate: string | null;
}

export function getPositionExecutionDates(executions: Execution[]): Map<string, PositionExecutionDates> {
  const dates = new Map<string, PositionExecutionDates>();

  executions.forEach((execution) => {
    const symbol = execution.symbol || '-';
    const row = dates.get(symbol) ?? { openDate: null, closeDate: null };

    if (execution.trade_date) {
      if (execution.is_open === false) {
        if (!row.closeDate || execution.trade_date > row.closeDate) {
          row.closeDate = execution.trade_date;
        }
      } else if (!row.openDate || execution.trade_date < row.openDate) {
        row.openDate = execution.trade_date;
      }
    }

    dates.set(symbol, row);
  });

  return dates;
}
