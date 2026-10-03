import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DailyStats, DailyJournal } from '@/types';

interface CalendarProps {
  dailyStats: DailyStats[];
  journals?: DailyJournal[];
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  onDayClick?: (date: string, stats: DailyStats | null) => void;
}

const DAYS_OF_WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function Calendar({ dailyStats, journals = [], year, month, onMonthChange, onDayClick }: CalendarProps) {

  const statsByDate = useMemo(() => {
    const map = new Map<string, DailyStats>();
    dailyStats.forEach((stat) => {
      map.set(stat.date, stat);
    });
    return map;
  }, [dailyStats]);

  const journalDates = useMemo(() => {
    const dates = new Set<string>();
    journals.forEach((journal) => {
      dates.add(journal.date);
    });
    return dates;
  }, [journals]);

  const calendarDays = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayOfMonth = new Date(year, month - 1, 1).getDay();
    const prevMonthDays = new Date(year, month - 1, 0).getDate();

    const days: Array<{
      date: number;
      dateStr: string;
      isCurrentMonth: boolean;
      stats?: DailyStats;
    }> = [];

    // Previous month days
    for (let i = firstDayOfMonth - 1; i >= 0; i--) {
      const date = prevMonthDays - i;
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      days.push({
        date,
        dateStr: `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(date).padStart(2, '0')}`,
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let date = 1; date <= daysInMonth; date++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
      days.push({
        date,
        dateStr,
        isCurrentMonth: true,
        stats: statsByDate.get(dateStr),
      });
    }

    // Next month days
    const remainingCells = 42 - days.length; // 6 rows * 7 columns
    for (let date = 1; date <= remainingCells; date++) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      days.push({
        date,
        dateStr: `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(date).padStart(2, '0')}`,
        isCurrentMonth: false,
      });
    }

    return days;
  }, [year, month, statsByDate]);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const handlePrevMonth = () => {
    if (month === 1) {
      onMonthChange(year - 1, 12);
    } else {
      onMonthChange(year, month - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      onMonthChange(year + 1, 1);
    } else {
      onMonthChange(year, month + 1);
    }
  };

  const handleToday = () => {
    const today = new Date();
    onMonthChange(today.getFullYear(), today.getMonth() + 1);
  };

  const handleDayClick = (day: typeof calendarDays[0]) => {
    if (!day.isCurrentMonth) return;
    
    if (onDayClick) {
      onDayClick(day.dateStr, day.stats || null);
    }
  };

  const getDayClassName = (day: typeof calendarDays[0]) => {
    const baseClass = 'calendar-day min-h-20 h-auto border border-border/50';
    
    if (!day.isCurrentMonth) {
      return `${baseClass} opacity-40`;
    }

    if (day.stats) {
      const hasClosedTrades = (day.stats.winning_trades || 0) + (day.stats.losing_trades || 0) + (day.stats.break_even_trades || 0) > 0;
      if (hasClosedTrades) {
        const pnl = day.stats.net_pnl;
        if (pnl > 0) {
          return `${baseClass} profit`;
        } else if (pnl < 0) {
          return `${baseClass} loss`;
        }
      } else {
        return `${baseClass} open`;
      }
    }

    return baseClass;
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Summary</h3>
          <span className="text-sm text-muted-foreground">(12 Months)</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handlePrevMonth}
            className="h-8 w-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[120px] text-center">
            {monthNames[month - 1]} {year}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={handleNextMonth}
            className="h-8 w-8"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToday}
            className="ml-2"
          >
            Today
          </Button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Day headers */}
        {DAYS_OF_WEEK.map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium text-muted-foreground py-2"
          >
            {day}
          </div>
        ))}

        {/* Calendar days */}
        {calendarDays.map((day, index) => {
          const hasJournal = journalDates.has(day.dateStr);
          return (
            <div
              key={index}
              className={getDayClassName(day)}
              onClick={() => handleDayClick(day)}
            >
              <span 
                className={`absolute top-1 left-2 ${
                  hasJournal 
                    ? 'text-sm font-bold text-primary' 
                    : 'text-sm font-medium'
                }`}
              >
                {day.date}
                {hasJournal && (
                  <span className="ml-0.5 text-[10px] text-primary">●</span>
                )}
              </span>
              {day.stats && (
                <div className="mt-4 text-center">
                  {(day.stats.winning_trades || 0) + (day.stats.losing_trades || 0) + (day.stats.break_even_trades || 0) > 0 ? (
                    <div
                      className={`text-sm font-semibold ${
                        day.stats.net_pnl >= 0 ? 'text-profit' : 'text-loss'
                      }`}
                    >
                      ${day.stats.net_pnl.toFixed(2)}
                    </div>
                  ) : (
                    <div className="text-xs font-medium text-muted-foreground mt-0.5">
                      Open
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {day.stats.total_trades} trades
                  </div>
                  {(day.stats.execution_count || 0) > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {day.stats.execution_count} execs
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
