import { Trophy, TrendingDown, MinusCircle, DollarSign, BarChart3, Clock, Calendar } from 'lucide-react';
import type { OverallStats, DailyStats } from '@/types';
import { useMemo } from 'react';

interface SummaryTableProps {
  stats: OverallStats;
  dailyStats?: DailyStats[];
}

interface SummaryRow {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  valueClass?: string;
}

export function SummaryTable({ stats, dailyStats = [] }: SummaryTableProps) {
  const formatCurrency = (value: number) => {
    const formatted = value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return value >= 0 ? `$${formatted}` : `-$${Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatNumber = (value: number) => {
    return value.toLocaleString('en-US');
  };

  // Calculate most active/profitable days from daily stats
  const { mostActive, mostProfitable, leastProfitable } = useMemo(() => {
    if (!dailyStats || dailyStats.length === 0) {
      return {
        mostActive: null,
        mostProfitable: null,
        leastProfitable: null,
      };
    }

    // Most active day (most trades)
    const mostActive = dailyStats.reduce((max, day) => 
      day.total_trades > max.total_trades ? day : max
    );

    // Most profitable day (highest net_pnl)
    const mostProfitable = dailyStats.reduce((max, day) => 
      day.net_pnl > max.net_pnl ? day : max
    );

    // Least profitable day (lowest net_pnl)
    const leastProfitable = dailyStats.reduce((min, day) => 
      day.net_pnl < min.net_pnl ? day : min
    );

    return { mostActive, mostProfitable, leastProfitable };
  }, [dailyStats]);

  const summaryRows: SummaryRow[] = [
    {
      icon: <DollarSign className="w-4 h-4 text-primary" />,
      label: 'Total Net P&L',
      value: formatCurrency(stats.net_pnl),
      valueClass: stats.net_pnl >= 0 ? 'text-profit font-bold text-lg' : 'text-loss font-bold text-lg',
    },
    {
      icon: <BarChart3 className="w-4 h-4" />,
      label: 'Total Trades',
      value: formatNumber(stats.total_trades),
    },
    {
      icon: <Trophy className="w-4 h-4 text-profit" />,
      label: 'Winning Trades',
      value: formatNumber(stats.winning_trades),
    },
    {
      icon: <TrendingDown className="w-4 h-4 text-loss" />,
      label: 'Losing Trades',
      value: formatNumber(stats.losing_trades),
    },
    {
      icon: <MinusCircle className="w-4 h-4 text-muted-foreground" />,
      label: 'Break Even Trades',
      value: formatNumber(stats.break_even_trades),
    },
    {
      icon: <DollarSign className="w-4 h-4" />,
      label: 'Total Commission',
      value: formatCurrency(stats.total_commission),
      valueClass: 'text-loss',
    },
    {
      icon: <TrendingDown className="w-4 h-4 text-profit" />,
      label: 'Largest Profit',
      value: formatCurrency(stats.largest_profit),
      valueClass: 'text-profit',
    },
    {
      icon: <TrendingDown className="w-4 h-4 text-loss" />,
      label: 'Largest Loss',
      value: formatCurrency(stats.largest_loss),
      valueClass: 'text-loss',
    },
    {
      icon: <Trophy className="w-4 h-4 text-profit" />,
      label: 'Avg Winning Trade',
      value: formatCurrency(stats.avg_win),
      valueClass: 'text-profit',
    },
    {
      icon: <TrendingDown className="w-4 h-4 text-loss" />,
      label: 'Avg Losing Trade',
      value: formatCurrency(stats.avg_loss),
      valueClass: 'text-loss',
    },
  ];

  // Format day for display
  const formatDay = (dateStr: string) => {
    const date = new Date(dateStr);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    return `${dayName} (${dateStr})`;
  };

  return (
    <div className="bg-card border border-border rounded-lg h-auto min-h-min overflow-hidden">
      <div className="p-4 border-b border-border">
        <h3 className="text-lg font-semibold">Summary Statistics</h3>
      </div>
      
      <div className="divide-y divide-border">
        {summaryRows.map((row, index) => (
          <div
            key={index}
            className="flex items-center justify-between px-4 py-3 hover:bg-secondary/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground">{row.icon}</span>
              <span className="text-sm text-muted-foreground">{row.label}</span>
            </div>
            <span className={`text-sm font-medium ${row.valueClass || ''}`}>
              {row.value}
            </span>
          </div>
        ))}
        
        {/* Most Active Day */}
        {mostActive && (
          <div className="flex items-center justify-between px-4 py-3 hover:bg-secondary/30 transition-colors">
            <div className="flex items-center gap-3">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Most Active Day</span>
            </div>
            <span className="text-sm font-medium">
              {formatDay(mostActive.date)} <span className="text-muted-foreground">{mostActive.total_trades} trades</span>
            </span>
          </div>
        )}
        
        {/* Most Profitable Day */}
        {mostProfitable && mostProfitable.net_pnl > 0 && (
          <div className="flex items-center justify-between px-4 py-3 hover:bg-secondary/30 transition-colors">
            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-profit" />
              <span className="text-sm text-muted-foreground">Most Profitable Day</span>
            </div>
            <span className="text-sm font-medium text-profit">
              {formatDay(mostProfitable.date)} {formatCurrency(mostProfitable.net_pnl)}
            </span>
          </div>
        )}
        
        {/* Least Profitable Day */}
        {leastProfitable && leastProfitable.net_pnl < 0 && (
          <div className="flex items-center justify-between px-4 py-3 hover:bg-secondary/30 transition-colors">
            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-loss" />
              <span className="text-sm text-muted-foreground">Least Profitable Day</span>
            </div>
            <span className="text-sm font-medium text-loss">
              {formatDay(leastProfitable.date)} {formatCurrency(leastProfitable.net_pnl)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
