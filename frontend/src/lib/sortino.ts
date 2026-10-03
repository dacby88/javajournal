import type { Account, AccountSettings, SortinoEquity, Trade } from '@/types';

export const SORTINO_TRADING_DAYS = 252;

interface TagSettings {
  selectedTagIds: number[];
  includeUntagged: boolean;
}

export interface SortinoStats {
  sortino_ratio: number;
  avgDailyReturn: number;
  downsideRisk: number;
  daysTraded: number;
  dailyTarget: number;
  error?: string;
}

export function parseSortinoSettings(form: {
  sortino_target: string;
  sortino_target_mode: 'fixed' | 'percent';
  starting_account_value: string;
}): AccountSettings {
  const percent = form.sortino_target_mode === 'percent';
  const target = form.sortino_target.trim() ? Number(form.sortino_target) : percent ? 1 : 1000;
  const value = form.starting_account_value.trim() ? Number(form.starting_account_value) : undefined;
  if (!Number.isFinite(target) || (percent && target <= -100)) {
    throw new Error(percent ? 'Enter a finite annual percentage greater than -100%.' : 'Enter a finite daily dollar target.');
  }
  if ((value !== undefined && (!Number.isFinite(value) || value < 0)) || (percent && (value === undefined || value <= 0))) {
    throw new Error('Enter a positive Starting Account Value for an annual percentage benchmark.');
  }
  return {
    sortino_target: target,
    sortino_target_mode: form.sortino_target_mode,
    ...(value !== undefined ? { starting_account_value: value } : {}),
  };
}

export function calculateSortinoStats(
  allTrades: Trade[], accounts: Account[], selectedAccounts: number[],
  cardTagSettings: TagSettings, equity?: SortinoEquity | null,
): SortinoStats {
  const empty: SortinoStats = { sortino_ratio: 0, avgDailyReturn: 0, downsideRisk: 0, daysTraded: 0, dailyTarget: 0 };
  // Get the Sortino targets for the selected accounts, defaulting to 1000 each.
  // In 'percent' mode the annual target uses starting value plus prior realized P&L.
  // With several accounts selected the daily targets are summed so the ratio is
  // measured against the combined capital base.
  const selectedAccountData = accounts.filter(account => selectedAccounts.length === 0 || selectedAccounts.includes(account.id));
  if (selectedAccounts.some(id => !selectedAccountData.some(account => account.id === id))) {
    return { ...empty, error: 'Account settings are unavailable. Refresh the dashboard.' };
  }
  const benchmarks = selectedAccountData.map(account => {
    const percent = account.settings?.sortino_target_mode === 'percent';
    return {
      id: account.id, name: account.name, percent,
      target: account.settings?.sortino_target ?? (percent ? 1 : 1000),
      starting: account.settings?.starting_account_value,
    };
  });
  const invalid = benchmarks.find(benchmark => !Number.isFinite(benchmark.target)
    || (benchmark.percent && (benchmark.target <= -100 || !Number.isFinite(benchmark.starting) || (benchmark.starting ?? 0) <= 0)));
  if (invalid) return { ...empty, error: `Check the annual benchmark and positive Starting Account Value for ${invalid.name}.` };
  if (benchmarks.some(benchmark => benchmark.percent) && !equity) {
    return { ...empty, error: 'Account equity history is unavailable. Refresh after the backend is updated.' };
  }

  const samples: { account_id?: number | null; exit_date?: string; trade_date?: string; is_open?: boolean; net_pnl: number; tags?: { id: number }[] }[] = equity?.daily_returns
    ? equity.daily_returns.map(row => ({ account_id: row.account_id, exit_date: row.date, net_pnl: row.net_pnl, tags: row.tag_ids.map(id => ({ id })) }))
    : allTrades;
  // Filter trades based on card tag settings
  const filteredTrades = samples.filter(trade => {
    if (trade.is_open === true || (selectedAccounts.length > 0 && trade.account_id != null && !selectedAccounts.includes(trade.account_id))) return false;
    const tradeTagIds = trade.tags?.map(tag => tag.id) ?? [];
    return tradeTagIds.length === 0 ? cardTagSettings.includeUntagged : cardTagSettings.selectedTagIds.some(id => tradeTagIds.includes(id));
  });

  // Group trades by day and calculate daily P&L totals
  const dailyPnLMap = new Map<string, number>();
  for (const trade of filteredTrades) {
    // Try multiple closing-date fields and formats
    const raw = trade.exit_date || trade.trade_date;
    // Handle both ISO format and simple date format
    const date = raw?.split('T')[0];
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || (equity?.start_date && date < equity.start_date)
      || (equity?.end_date && date > equity.end_date)) continue;
    const pnl = trade.net_pnl ?? 0;
    if (!Number.isFinite(pnl)) return { ...empty, error: 'A trade has invalid realized P&L. Correct the record before calculating Sortino.' };
    dailyPnLMap.set(date, (dailyPnLMap.get(date) ?? 0) + pnl);
  }
  const days = [...dailyPnLMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  const accumulated = new Map<number, number>();
  for (const row of equity?.opening_pnl ?? []) {
    if (row.account_id != null) accumulated.set(row.account_id, (accumulated.get(row.account_id) ?? 0) + row.net_pnl);
  }
  const history = [...(equity?.daily_pnl ?? [])].filter(row => !equity?.end_date || row.date <= equity.end_date)
    .sort((a, b) => a.date.localeCompare(b.date));
  let cursor = 0;
  const targetAt = (date?: string): number | null => {
    while (cursor < history.length && (!date || history[cursor].date < date)) {
      const row = history[cursor++];
      if (row.account_id != null) accumulated.set(row.account_id, (accumulated.get(row.account_id) ?? 0) + row.net_pnl);
    }
    if (benchmarks.length === 0) return 1000;
    let target = 0;
    for (const benchmark of benchmarks) {
      if (!benchmark.percent) {
        target += benchmark.target;
        continue;
      }
      const balance = (benchmark.starting ?? 0) + (accumulated.get(benchmark.id) ?? 0);
      if (!Number.isFinite(balance) || balance <= 0) return null;
      target += balance * Math.expm1(Math.log1p(benchmark.target / 100) / SORTINO_TRADING_DAYS);
    }
    return Number.isFinite(target) ? target : null;
  };
  const dailyTargets: number[] = [];
  for (const [date] of days) {
    const target = targetAt(date);
    if (target === null) return { ...empty, error: 'Account equity must stay positive for an annual percentage benchmark.' };
    dailyTargets.push(target);
  }
  if (days.length === 0) {
    const target = targetAt();
    return target === null
      ? { ...empty, error: 'Account equity must stay positive for an annual percentage benchmark.' }
      : { ...empty, dailyTarget: target };
  }
  const dailyReturns = days.map(([, pnl]) => pnl);
  const dailyTarget = dailyTargets.reduce((sum, target) => sum + target, 0) / days.length;

  // Daily benchmark excess
  const dailyExcess = dailyReturns.map((pnl, index) => pnl - dailyTargets[index]);
  // Calculate average daily return
  const avgDailyReturn = dailyReturns.reduce((sum, pnl) => sum + pnl, 0) / days.length;
  // Calculate downside deviation based on daily returns vs their daily targets
  // For each day below target, calculate (target - dailyPnL)^2
  const downsideSquaredDeviations = dailyExcess.map(excess => Math.min(excess, 0) ** 2);
  // Downside variance = sum of squared deviations / total number of days
  const downsideVariance = downsideSquaredDeviations.reduce((sum, deviation) => sum + deviation, 0) / days.length;
  // Downside deviation = square root of variance
  const downsideDeviation = Math.sqrt(downsideVariance);
  // Sortino Ratio = (Average Daily Return - Average Daily Target) / Downside Deviation
  const ratio = downsideDeviation > 0 ? (avgDailyReturn - dailyTarget) / downsideDeviation : 0;
  return { sortino_ratio: Number.isFinite(ratio) ? ratio : 0, avgDailyReturn, downsideRisk: downsideDeviation, daysTraded: days.length, dailyTarget };
}
