import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: ReactNode;
  tooltip?: string;
  className?: string;
  valueClassName?: string;
  children?: ReactNode;
  headerAction?: ReactNode;
}

export function MetricCard({
  title,
  value,
  subtitle,
  tooltip,
  className = '',
  valueClassName = '',
  children,
  headerAction,
}: MetricCardProps) {
  return (
    <Card className={`metric-card bg-card border-border h-full ${className}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {title}
            {tooltip && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">{tooltip}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {headerAction && <div className="flex-shrink-0">{headerAction}</div>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${valueClassName}`}>{value}</div>
        {subtitle && <div className="mt-1 text-sm">{subtitle}</div>}
        {children}
      </CardContent>
    </Card>
  );
}

interface ProgressMetricCardProps extends MetricCardProps {
  progress: number;
  progressColor?: 'profit' | 'loss' | 'neutral';
  showPercentage?: boolean;
}

export function ProgressMetricCard({
  title,
  value,
  progress,
  progressColor = 'neutral',
  showPercentage = true,
  tooltip,
  className = '',
  valueClassName = '',
}: ProgressMetricCardProps) {
  const colorClasses = {
    profit: 'bg-profit',
    loss: 'bg-loss',
    neutral: 'bg-primary',
  };

  return (
    <Card className={`metric-card bg-card border-border ${className}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          {title}
          {tooltip && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">{tooltip}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline justify-between">
          <span className={`text-2xl font-bold ${valueClassName}`}>{value}</span>
          {showPercentage && (
            <span className="text-sm text-muted-foreground">{progress.toFixed(1)}%</span>
          )}
        </div>
        <div className="mt-3 h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full ${colorClasses[progressColor]} progress-bar`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface StreakMetricCardProps {
  title: string;
  longestWin: number;
  longestWinAmount: number;
  longestLoss: number;
  longestLossAmount: number;
  currentStreak: number;
  currentStreakType: 'win' | 'loss';
  tooltip?: string;
}

export function StreakMetricCard({
  title,
  longestWin,
  longestWinAmount,
  longestLoss,
  longestLossAmount,
  currentStreak,
  currentStreakType,
  tooltip,
}: StreakMetricCardProps) {
  return (
    <Card className="metric-card bg-card border-border h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          {title}
          {tooltip && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">{tooltip}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-secondary/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Longest Win Streak</div>
            <div className="text-xl font-bold text-profit">{longestWin}</div>
            <div className="text-xs text-profit">${longestWinAmount.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground mt-1">days</div>
          </div>
          <div className="bg-secondary/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Longest Loss Streak</div>
            <div className="text-xl font-bold text-loss">{longestLoss}</div>
            <div className="text-xs text-loss">${longestLossAmount.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground mt-1">days</div>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Current Streak:</span>
            <span className={`font-medium ${currentStreakType === 'win' ? 'text-profit' : 'text-loss'}`}>
              {currentStreak} day{currentStreak !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="mt-2 flex gap-1">
            {Array.from({ length: Math.min(currentStreak, 12) }).map((_, i) => (
              <div
                key={i}
                className={`streak-dot ${currentStreakType}`}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
