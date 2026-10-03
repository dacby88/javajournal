import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Header, type TimePeriod, type Theme } from '@/components/Header';
import { MetricCard, ProgressMetricCard, StreakMetricCard } from '@/components/MetricCard';
import { Calendar } from '@/components/Calendar';
import { SummaryTable } from '@/components/SummaryTable';
import { DayTradesModal } from '@/components/DayTradesModal';
import { ExecutionEditModal } from '@/components/ExecutionEditModal';
import { SnapshotButton } from '@/components/SnapshotButton';
import { api } from '@/services/api';
import type { DashboardData, OverallStats, DailyStats, DailyJournal, Trade, TradeTag, Account, Execution } from '@/types';
import { AlertCircle, Eye, EyeOff, Settings2, Info, ChevronLeft, ChevronRight, ExternalLink, Settings, CalendarDays, CalendarRange } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { calculateSortinoStats } from '@/lib/sortino';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar, AreaChart, Area, ReferenceLine } from 'recharts';

const defaultStats: OverallStats = {
  id: 1,
  total_trades: 0,
  winning_trades: 0,
  losing_trades: 0,
  break_even_trades: 0,
  win_rate: 0,
  loss_rate: 0,
  gross_profit: 0,
  gross_loss: 0,
  net_pnl: 0,
  total_commission: 0,
  avg_win: 0,
  avg_loss: 0,
  largest_profit: 0,
  largest_loss: 0,
  profit_factor: 0,
  expectancy: 0,
  sharpe_ratio: 0,
  sortino_ratio: 0,
  calmar_ratio: 0,
  avg_trade_duration: 0,
  longest_win_streak: 0,
  longest_loss_streak: 0,
  longest_win_streak_amount: 0,
  longest_loss_streak_amount: 0,
  current_streak: 0,
  current_streak_type: 'win',
  mfe_capture: 0,
  mae_recovery: 0,
  efficiency_ratio: 0,
  avg_risk_reward: 0,
  exit_gap: 0,
  left_on_table: 0,
  good_captures: 0,
  updated_at: new Date().toISOString(),
};

// Card visibility configuration
type CardKey = 'expectancy' | 'sharpe' | 'sortino' | 'streak' | 'intraday' | 'duration' | 'maeMfe' | 'cumulativePnl' | 'drawdown' | 'weeklyPnl' | 'symbolPnl' | 'entryHourPnl' | 'openTrades' | 'tagPnl' | 'winRateByEntryHour';

const defaultVisibleCards: Record<CardKey, boolean> = {
  expectancy: true,
  sharpe: true,
  sortino: true,
  streak: true,
  intraday: true,
  duration: true,
  maeMfe: false, // Hidden by default
  cumulativePnl: true,
  drawdown: true,
  weeklyPnl: true,
  symbolPnl: true,
  entryHourPnl: true,
  openTrades: true,
  tagPnl: true,
  winRateByEntryHour: true,
};

const SELECTED_ACCOUNTS_KEY = 'dashboard_selected_accounts';

function loadPersistedAccounts(): number[] {
  try {
    const raw = sessionStorage.getItem(SELECTED_ACCOUNTS_KEY);
    if (!raw) return [];
    // Migrate the legacy single-account key
    if (raw.startsWith('[')) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((id) => parseInt(String(id), 10)).filter((id) => !Number.isNaN(id));
    }
    const legacy = parseInt(raw, 10);
    return Number.isNaN(legacy) ? [] : [legacy];
  } catch {
    return [];
  }
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>(loadPersistedAccounts);
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>('all');
  const [visibleCards, setVisibleCards] = useState<Record<CardKey, boolean>>(defaultVisibleCards);
  const [showCardSettings, setShowCardSettings] = useState(false);
  
  // Card order state - array of card keys in display order
  const [cardOrder, setCardOrder] = useState<CardKey[]>([
    'expectancy', 'sharpe', 'sortino', 'streak', 'intraday', 'duration', 'tagPnl', 'winRateByEntryHour',
    'cumulativePnl', 'drawdown', 'weeklyPnl', 'symbolPnl', 'entryHourPnl', 'openTrades', 'maeMfe'
  ]);
  const [excludeSPX, setExcludeSPX] = useState(false);
  const [pnlHistogramView, setPnlHistogramView] = useState<'weekly' | 'monthly'>('weekly');
  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [customDateRange, setCustomDateRange] = useState<{ startDate: Date; endDate: Date } | undefined>(undefined);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [theme, setThemeState] = useState<Theme>('java');
  
  // Day trades modal state
  const [dayModalOpen, setDayModalOpen] = useState(false);
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);
  const [selectedDayStats, setSelectedDayStats] = useState<DailyStats | null>(null);
  
  // Journals state for calendar
  const [journals, setJournals] = useState<DailyJournal[]>([]);
  
  // Accounts state for account-specific settings
  const [accounts, setAccounts] = useState<Account[]>([]);
  
  // Card-specific settings state
  const [availableTags, setAvailableTags] = useState<TradeTag[]>([]);
  const [cardSettingsModalOpen, setCardSettingsModalOpen] = useState(false);
  const [activeCardSettings, setActiveCardSettings] = useState<CardKey | null>(null);
  
  // Execution edit modal state
  const [editingExecution, setEditingExecution] = useState<Execution | null>(null);
  
  // Shared card settings for tag filtering
  const [cardTagSettings, setCardTagSettings] = useState<{
    selectedTagIds: number[];
    includeUntagged: boolean;
    intradayOnly: boolean;
  }>({
    selectedTagIds: [], // Default: all tags except "Margin"
    includeUntagged: false, // Default: exclude untagged
    intradayOnly: true, // Default: only intraday trades
  });
  
  // Ref for snapshot
  const mainContentRef = useRef<HTMLElement>(null);
  const dashboardRequestId = useRef(0);

  // Load theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    if (savedTheme && ['java', 'dark', 'earth', 'terminal', 'tokyo'].includes(savedTheme)) {
      setThemeState(savedTheme);
    }
  }, []);
  
  // Fetch available tags for card settings
  useEffect(() => {
    const fetchTags = async () => {
      try {
        const response = await api.getTags();
        if (response.success) {
          setAvailableTags(response.data);
          // Set default selected tags (all except "Margin")
          const nonMarginTagIds = response.data
            .filter(tag => tag.name.toLowerCase() !== 'margin')
            .map(tag => tag.id);
          setCardTagSettings(prev => ({
            ...prev,
            selectedTagIds: nonMarginTagIds,
          }));
        }
      } catch (error) {
        console.error('Failed to fetch tags:', error);
      }
    };
    fetchTags();
  }, []);
  
  // Fetch accounts for account-specific settings
  const loadAccounts = useCallback(async () => {
    try {
      const response = await api.getAccounts(true);
      if (response.success) {
        setAccounts(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch accounts:', error);
    }
  }, []);
  
  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Apply theme to document and save to localStorage
  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const fetchData = useCallback(async () => {
    const requestId = ++dashboardRequestId.current;
    try {
      setError(null);
      
      // Calculate date range based on selected period
      let startDate: Date | undefined;
      let endDate: Date = new Date();
      
      if (selectedPeriod === 'custom' && customDateRange) {
        startDate = customDateRange.startDate;
        endDate = customDateRange.endDate;
      } else {
        const now = new Date();
        switch (selectedPeriod) {
          case '1w':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case '1m':
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
            break;
          case '3m':
            startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
            break;
          case '6m':
            startDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
            break;
          case '1y':
            startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
            break;
          case 'ytd':
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
          case 'all':
          default:
            startDate = undefined;
            break;
        }
      }
      
      const response = await api.getDashboard(
        undefined, // Don't filter by month when using date range
        undefined,
        selectedAccounts,
        startDate?.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0],
        false // Don't exclude margin trades from dashboard data - we handle this locally for expectancy only
      );
      if (requestId !== dashboardRequestId.current) return;
      if (response.success) {
        setData(response.data);
      }
      
      // Fetch all trades for expectancy calculation
      const tradesResponse = await api.getAllTrades(
        startDate?.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0],
        selectedAccounts
      );
      if (requestId !== dashboardRequestId.current) return;
      if (tradesResponse.success) {
        setAllTrades(tradesResponse.data);
      }
    } catch (err) {
      if (requestId === dashboardRequestId.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      }
    } finally {
      if (requestId === dashboardRequestId.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [currentDate, selectedAccounts, selectedPeriod, customDateRange, refreshTrigger]);

  useEffect(() => {
    fetchData();
    return () => {
      dashboardRequestId.current += 1;
    };
  }, [fetchData]);

  // Fetch journals for the current month to show on calendar
  useEffect(() => {
    const fetchJournals = async () => {
      try {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const startDate = new Date(year, month, 1).toISOString().split('T')[0];
        const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];
        const response = await api.getJournals(startDate, endDate);
        if (response.success) {
          setJournals(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch journals:', error);
      }
    };
    fetchJournals();
  }, [currentDate]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchData();
  };

  const handleImportSuccess = () => {
    // Trigger a refresh to show new data
    setRefreshTrigger(prev => prev + 1);
  };

  const handleAccountsChange = (accountIds: number[]) => {
    setSelectedAccounts(accountIds);
    // Persist to sessionStorage
    sessionStorage.setItem(SELECTED_ACCOUNTS_KEY, JSON.stringify(accountIds));
    sessionStorage.removeItem('dashboard_selected_account');
    setIsRefreshing(true);
  };

  const handlePeriodChange = (period: TimePeriod) => {
    setSelectedPeriod(period);
    if (period !== 'custom') {
      setCustomDateRange(undefined);
    }
    // No need to refresh since filtering is client-side
  };

  const handleCustomDateChange = (range: { startDate: Date; endDate: Date }) => {
    setCustomDateRange(range);
  };

  const handleMonthChange = (year: number, month: number) => {
    setCurrentDate(new Date(year, month - 1));
  };

  const handleDayClick = (date: string, dayStats: DailyStats | null) => {
    setSelectedDayDate(date);
    setSelectedDayStats(dayStats);
    setDayModalOpen(true);
  };

  const handleOpenPositionClick = async (pos: { id: number | string; symbol: string; type?: 'P' | 'T'; account_id?: number }) => {
    if (pos.type === 'T') {
      window.open(`/trades/${pos.id}`, '_blank');
      return;
    }
    try {
      const response = await api.getExecutions({
        symbol: pos.symbol,
        matched: false,
        account_ids: selectedAccounts,
        limit: 1,
      });
      if (response.success && response.data.length > 0) {
        setEditingExecution(response.data[0]);
      } else {
        console.warn('No unmatched execution found for symbol:', pos.symbol);
      }
    } catch (err) {
      console.error('Failed to fetch execution for editing:', err);
    }
  };

  const toggleCard = (key: CardKey) => {
    setVisibleCards(prev => ({ ...prev, [key]: !prev[key] }));
  };
  
  // Move card in the order array
  const moveCard = (key: CardKey, direction: 'left' | 'right') => {
    setCardOrder(prev => {
      const index = prev.indexOf(key);
      if (index === -1) return prev;
      
      const newOrder = [...prev];
      if (direction === 'left' && index > 0) {
        // Swap with previous
        [newOrder[index], newOrder[index - 1]] = [newOrder[index - 1], newOrder[index]];
      } else if (direction === 'right' && index < newOrder.length - 1) {
        // Swap with next
        [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      }
      return newOrder;
    });
  };

  const stats = data?.overall ? {
    ...defaultStats,
    ...data.overall,
    // Ensure these fields are numbers, not null
    longest_win_streak_amount: data.overall.longest_win_streak_amount ?? 0,
    longest_loss_streak_amount: data.overall.longest_loss_streak_amount ?? 0,
    mfe_capture: data.overall.mfe_capture ?? 0,
    mae_recovery: data.overall.mae_recovery ?? 0,
    efficiency_ratio: data.overall.efficiency_ratio ?? 0,
    avg_risk_reward: data.overall.avg_risk_reward ?? 0,
    exit_gap: data.overall.exit_gap ?? 0,
    left_on_table: data.overall.left_on_table ?? 0,
    good_captures: data.overall.good_captures ?? 0,
  } : defaultStats;

  // Calculate expectancy stats from trades with tag filtering
  const expectancyStats = useMemo(() => {
    // Filter trades based on card tag settings
    const filteredTrades = allTrades.filter(trade => {
      const tradeTagIds = trade.tags?.map(t => t.id) || [];
      const hasSelectedTag = cardTagSettings.selectedTagIds.some(id => tradeTagIds.includes(id));
      const isUntagged = tradeTagIds.length === 0;
      
      if (isUntagged) {
        return cardTagSettings.includeUntagged;
      }
      
      return hasSelectedTag;
    });
    
    if (filteredTrades.length === 0) {
      return {
        expectancy: stats.expectancy,
        winRate: stats.win_rate,
        lossRate: stats.loss_rate,
        avgWin: stats.avg_win,
        avgLoss: stats.avg_loss,
        totalTrades: stats.total_trades,
      };
    }

    const totalTrades = filteredTrades.length;
    const winningTrades = filteredTrades.filter(t => (t.net_pnl || 0) > 0);
    const losingTrades = filteredTrades.filter(t => (t.net_pnl || 0) < 0);
    
    const winCount = winningTrades.length;
    const lossCount = losingTrades.length;
    
    const winRate = (winCount / totalTrades) * 100;
    const lossRate = (lossCount / totalTrades) * 100;
    
    const avgWin = winCount > 0 ? winningTrades.reduce((sum, t) => sum + (t.net_pnl || 0), 0) / winCount : 0;
    const avgLoss = lossCount > 0 ? losingTrades.reduce((sum, t) => sum + (t.net_pnl || 0), 0) / lossCount : 0;
    
    // Expectancy = (Win% * Avg Win) + (Loss% * Avg Loss)
    // Avg Loss is negative, so this automatically handles the subtraction
    const expectancy = (winRate / 100) * avgWin + (lossRate / 100) * avgLoss;
    
    return {
      expectancy,
      winRate,
      lossRate,
      avgWin,
      avgLoss,
      totalTrades,
    };
  }, [allTrades, cardTagSettings, stats]);

  // Calculate Sortino Ratio from filtered trades (grouped by day)
  const sortinoStats = useMemo(() => calculateSortinoStats(
    allTrades, accounts, selectedAccounts, cardTagSettings, data?.sortino_equity,
  ), [allTrades, accounts, selectedAccounts, cardTagSettings, data?.sortino_equity]);

  // Prepare intraday activity data from filtered trades
  const hourlyData = useMemo(() => {
    // Filter trades based on card tag settings
    const filteredTrades = allTrades.filter(trade => {
      const tradeTagIds = trade.tags?.map(t => t.id) || [];
      const hasSelectedTag = cardTagSettings.selectedTagIds.some(id => tradeTagIds.includes(id));
      const isUntagged = tradeTagIds.length === 0;
      
      if (isUntagged) {
        return cardTagSettings.includeUntagged;
      }
      
      return hasSelectedTag;
    });
    
    // Group trades by entry hour
    const hourMap = new Map<number, { trades: number; pnl: number }>();
    
    filteredTrades.forEach(trade => {
      // Try to get hour from entry_time first, then from entry_date
      let hour: number | null = null;
      
      if (trade.entry_time) {
        // entry_time might be "HH:MM:SS" or a full datetime "YYYY-MM-DDTHH:MM:SS"
        if (trade.entry_time.includes('T')) {
          const date = new Date(trade.entry_time);
          if (!isNaN(date.getTime())) {
            hour = date.getHours();
          }
        } else {
          hour = parseInt(trade.entry_time.split(':')[0], 10);
        }
      } else if (trade.entry_date) {
        const date = new Date(trade.entry_date);
        if (!isNaN(date.getTime())) {
          hour = date.getHours();
        }
      }
      
      if (hour === null || isNaN(hour)) return;
      
      const existing = hourMap.get(hour) || { trades: 0, pnl: 0 };
      existing.trades += 1; // Count actual trades, not executions
      existing.pnl += trade.net_pnl || 0;
      hourMap.set(hour, existing);
    });
    
    // Convert to array format for the pie chart
    return Array.from(hourMap.entries())
      .filter(([_, stats]) => stats.trades > 0)
      .map(([hour, stats]) => ({
        name: `${hour}:00`,
        value: stats.trades,
        pnl: stats.pnl,
        hour: hour,
      }));
  }, [allTrades, cardTagSettings]);

  // Prepare duration data - filter out trailing empty buckets
  const durationPnlData = useMemo(() => {
    const buckets = data?.duration_pnl || [];
    if (buckets.length === 0) return [];
    
    // Find the last bucket with trades
    let lastIndexWithTrades = -1;
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (buckets[i].count > 0) {
        lastIndexWithTrades = i;
        break;
      }
    }
    
    // Return only buckets up to and including the last one with trades
    if (lastIndexWithTrades >= 0) {
      return buckets.slice(0, lastIndexWithTrades + 1);
    }
    
    return buckets;
  }, [data?.duration_pnl]);

  // Use backend-filtered data directly
  const dailyData = data?.daily || [];

  // Calculate the end date of the data being shown
  const dataEndDate = useMemo(() => {
    if (selectedPeriod === 'custom' && customDateRange) {
      return customDateRange.endDate;
    }
    if (data?.last_execution_date) {
      return new Date(data.last_execution_date);
    }
    return new Date();
  }, [data?.last_execution_date, selectedPeriod, customDateRange]);

  // Prepare cumulative P&L data from daily stats
  const cumulativePnlData = useMemo(() => {
    if (dailyData.length === 0) return [];
    
    const sorted = [...dailyData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let cumulative = 0;
    
    return sorted.map(day => {
      cumulative += day.net_pnl;
      return {
        date: formatDate(day.date),
        pnl: day.net_pnl,
        cumulative: cumulative,
      };
    });
  }, [dailyData]);

  // Prepare drawdown data (underwater chart)
  const { drawdownData, maxDrawdown, maxDaysToRecover } = useMemo(() => {
    if (dailyData.length === 0) {
      return { drawdownData: [], maxDrawdown: 0, maxDaysToRecover: 0 };
    }
    
    const sorted = [...dailyData].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let cumulative = 0;
    let peak = 0;
    const data: Array<{ date: string; drawdown: number; isDrawdown: boolean }> = [];
    
    // Track drawdown periods for max days to recover
    let inDrawdown = false;
    let drawdownStartIndex = 0;
    let maxDD = 0;
    let maxRecoveryDays = 0;
    
    sorted.forEach((day, index) => {
      cumulative += day.net_pnl;
      if (cumulative > peak) {
        // Exited drawdown
        if (inDrawdown) {
          const recoveryDays = index - drawdownStartIndex;
          maxRecoveryDays = Math.max(maxRecoveryDays, recoveryDays);
          inDrawdown = false;
        }
        peak = cumulative;
      }
      
      const drawdown = cumulative - peak;
      maxDD = Math.min(maxDD, drawdown);
      
      // Entered drawdown
      if (drawdown < 0 && !inDrawdown) {
        inDrawdown = true;
        drawdownStartIndex = index;
      }
      
      data.push({
        date: formatDate(day.date),
        drawdown: drawdown,
        isDrawdown: drawdown < 0,
      });
    });
    
    // If still in drawdown at end, count days so far
    if (inDrawdown) {
      const recoveryDays = sorted.length - drawdownStartIndex;
      maxRecoveryDays = Math.max(maxRecoveryDays, recoveryDays);
    }
    
    return { drawdownData: data, maxDrawdown: maxDD, maxDaysToRecover: maxRecoveryDays };
  }, [dailyData]);

  // Prepare weekly P&L histogram data
  const weeklyPnlData = useMemo(() => {
    if (dailyData.length === 0) return [];
    
    // Use an object with date and pnl to preserve sorting
    const weeklyMap = new Map<string, { date: Date; pnl: number }>();
    
    dailyData.forEach(day => {
      const date = new Date(day.date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay()); // Sunday
      weekStart.setHours(0, 0, 0, 0); // Normalize time
      
      const weekKey = weekStart.toISOString().split('T')[0]; // YYYY-MM-DD for sorting
      const existing = weeklyMap.get(weekKey);
      
      if (existing) {
        existing.pnl += day.net_pnl;
      } else {
        weeklyMap.set(weekKey, { date: weekStart, pnl: day.net_pnl });
      }
    });
    
    // Sort by date, take last 12 weeks, then format for display
    return Array.from(weeklyMap.entries())
      .sort((a, b) => a[1].date.getTime() - b[1].date.getTime())
      .slice(-12) // Last 12 weeks
      .map(([_, data]) => ({
        week: formatDate(data.date),
        pnl: data.pnl,
        color: data.pnl >= 0 ? '#22c55e' : '#ef4444',
      }));
  }, [dailyData]);

  // Prepare monthly P&L histogram data
  const monthlyPnlData = useMemo(() => {
    if (dailyData.length === 0) return [];

    const monthlyMap = new Map<string, { date: Date; pnl: number }>();

    dailyData.forEach(day => {
      const date = new Date(day.date);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthKey = monthStart.toISOString().split('T')[0]; // YYYY-MM-01 for sorting
      const existing = monthlyMap.get(monthKey);

      if (existing) {
        existing.pnl += day.net_pnl;
      } else {
        monthlyMap.set(monthKey, { date: monthStart, pnl: day.net_pnl });
      }
    });

    // Sort by date, take last 12 months, then format for display
    return Array.from(monthlyMap.entries())
      .sort((a, b) => a[1].date.getTime() - b[1].date.getTime())
      .slice(-12) // Last 12 months
      .map(([_, data]) => ({
        month: data.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        pnl: data.pnl,
        color: data.pnl >= 0 ? '#22c55e' : '#ef4444',
      }));
  }, [dailyData]);

  // Prepare symbol P&L histogram data from backend
  const symbolPnlData = useMemo(() => {
    const symbolPnl = data?.symbol_pnl || [];
    return symbolPnl
      .filter((item): item is { symbol: string; pnl: number } => 
        item && typeof item.symbol === 'string' && typeof item.pnl === 'number'
      )
      .filter(({ symbol }) => !excludeSPX || symbol !== 'SPX')
      .map(({ symbol, pnl }) => ({
        symbol,
        pnl,
        color: pnl >= 0 ? '#22c55e' : '#ef4444',
      }));
  }, [data?.symbol_pnl, excludeSPX]);

  // Prepare entry hour P&L data
  const entryHourPnlData = useMemo(() => {
    const hourlyData = data?.trade_pnl_by_hour || [];
    return hourlyData
      .filter((item): item is { hour: number; pnl: number } =>
        item && typeof item.hour === 'number' && typeof item.pnl === 'number'
      )
      .map(({ hour, pnl }) => ({
        hour: `${hour}:00`,
        hourNum: hour,
        pnl,
        color: pnl >= 0 ? '#22c55e' : '#ef4444',
      }));
  }, [data?.trade_pnl_by_hour]);

  // Prepare tag P&L data including untagged bucket
  const tagPnlData = useMemo(() => {
    const backendTagPnl = data?.tag_pnl || [];
    
    // Calculate untagged trades P&L
    const untaggedTrades = allTrades.filter(trade => !trade.tags || trade.tags.length === 0);
    const untaggedPnl = untaggedTrades.reduce((sum, trade) => sum + (trade.net_pnl || 0), 0);
    
    // Create untagged bucket if there are untagged trades
    const untaggedBucket = untaggedTrades.length > 0 ? [{
      tag: '(untagged)',
      pnl: untaggedPnl,
      count: untaggedTrades.length,
      color: untaggedPnl >= 0 ? '#22c55e' : '#ef4444',
    }] : [];
    
    // Combine backend tag data with untagged bucket
    return [...backendTagPnl, ...untaggedBucket];
  }, [data?.tag_pnl, allTrades]);

  // Prepare win rate by entry hour data (calculated from filtered trades)
  const winRateByEntryHourData = useMemo(() => {
    // Filter trades based on card tag settings
    const filteredTrades = allTrades.filter(trade => {
      const tradeTagIds = trade.tags?.map(t => t.id) || [];
      const hasSelectedTag = cardTagSettings.selectedTagIds.some(id => tradeTagIds.includes(id));
      const isUntagged = tradeTagIds.length === 0;
      
      if (isUntagged) {
        return cardTagSettings.includeUntagged;
      }
      
      return hasSelectedTag;
    });

    // Group by entry hour and calculate win rate
    const hourMap = new Map<number, { wins: number; total: number }>();
    
    filteredTrades.forEach(trade => {
      // Try to get hour from entry_time first, then from entry_date
      let hour: number | null = null;
      
      if (trade.entry_time) {
        // entry_time might be "HH:MM:SS" or a full datetime "YYYY-MM-DDTHH:MM:SS"
        // Check if it contains 'T' (ISO datetime format)
        if (trade.entry_time.includes('T')) {
          const date = new Date(trade.entry_time);
          if (!isNaN(date.getTime())) {
            hour = date.getHours();
          }
        } else {
          // Simple time format "HH:MM:SS"
          hour = parseInt(trade.entry_time.split(':')[0], 10);
        }
      } else if (trade.entry_date) {
        // Try to extract time from ISO date string
        const date = new Date(trade.entry_date);
        if (!isNaN(date.getTime())) {
          hour = date.getHours();
        }
      }
      
      if (hour === null || isNaN(hour)) return;
      
      const existing = hourMap.get(hour) || { wins: 0, total: 0 };
      existing.total += 1;
      if ((trade.net_pnl || 0) > 0) {
        existing.wins += 1;
      }
      hourMap.set(hour, existing);
    });

    // Convert to array and calculate win rates
    const result = Array.from(hourMap.entries())
      .map(([hour, stats]) => ({
        hour: `${hour}:00`,
        hourNum: hour,
        winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
        wins: stats.wins,
        total: stats.total,
      }))
      .sort((a, b) => a.hourNum - b.hourNum);

    return result;
  }, [allTrades, cardTagSettings]);

  const formatCurrency = (value: number | null | undefined) => {
    if (value == null || isNaN(value)) return '$0.00';
    return value >= 0 
      ? `$${value.toFixed(2)}` 
      : `-$${Math.abs(value).toFixed(2)}`;
  };

  // Card wrapper with reorder arrows
  const CardWrapper = ({ cardKey, children, className = '' }: { cardKey: CardKey; children: React.ReactNode; className?: string }) => {
    const index = cardOrder.indexOf(cardKey);
    const isFirst = index === 0;
    const isLast = index === cardOrder.length - 1;
    
    // If card is hidden, don't render it at all
    if (!visibleCards[cardKey]) {
      return null;
    }
    
    return (
      <div className={`relative group ${className}`}>
        {children}
        {/* Reorder arrows - bottom right */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => moveCard(cardKey, 'left')}
            disabled={isFirst}
            className={`p-1 rounded bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors ${isFirst ? 'opacity-30 cursor-not-allowed' : ''}`}
            title="Move left"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <button
            onClick={() => moveCard(cardKey, 'right')}
            disabled={isLast}
            className={`p-1 rounded bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors ${isLast ? 'opacity-30 cursor-not-allowed' : ''}`}
            title="Move right"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  };

  // Card header component for consistent styling
  const CardHeaderWithTooltip = ({ title, tooltip, children }: { title: string; tooltip?: string; children?: React.ReactNode }) => (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold">{title}</h3>
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
      {children}
    </div>
  );

  // Handler to open card settings modal
  const openCardSettings = (cardKey: CardKey) => {
    setActiveCardSettings(cardKey);
    setCardSettingsModalOpen(true);
  };

  // Handler to close card settings modal
  const closeCardSettings = () => {
    setCardSettingsModalOpen(false);
    setActiveCardSettings(null);
  };

  // Handler to toggle tag selection
  const toggleTagSelection = (tagId: number) => {
    setCardTagSettings(prev => ({
      ...prev,
      selectedTagIds: prev.selectedTagIds.includes(tagId)
        ? prev.selectedTagIds.filter(id => id !== tagId)
        : [...prev.selectedTagIds, tagId],
    }));
  };

  // Card Settings Modal Component
  const CardSettingsModal = () => {
    if (!cardSettingsModalOpen || !activeCardSettings) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Card Settings</h3>
            <button
              onClick={closeCardSettings}
              className="p-1 rounded hover:bg-secondary text-muted-foreground"
            >
              ✕
            </button>
          </div>

          {/* Tag Settings - Shared by multiple cards */}
          {['winRateByEntryHour', 'entryHourPnl', 'intraday', 'duration', 'expectancy', 'sharpe', 'sortino'].includes(activeCardSettings) && (
            <div className="space-y-4">
              {/* Intraday Only Checkbox */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="intraday-only"
                  checked={cardTagSettings.intradayOnly}
                  onChange={(e) => setCardTagSettings(prev => ({ ...prev, intradayOnly: e.target.checked }))}
                  className="w-4 h-4 rounded border-border"
                />
                <label htmlFor="intraday-only" className="text-sm cursor-pointer">
                  Only intraday trades
                </label>
              </div>

              {/* Tags Section */}
              <div>
                <div className="text-sm font-medium mb-2">Include Tags</div>
                <div className="space-y-2 max-h-48 overflow-y-auto border border-border rounded p-2">
                  {/* Untagged option */}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="tag-untagged"
                      checked={cardTagSettings.includeUntagged}
                      onChange={(e) => setCardTagSettings(prev => ({ ...prev, includeUntagged: e.target.checked }))}
                      className="w-4 h-4 rounded border-border"
                    />
                    <label htmlFor="tag-untagged" className="text-sm cursor-pointer flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-gray-400"></span>
                      Untagged trades
                    </label>
                  </div>
                  <div className="border-t border-border my-2"></div>
                  {/* Available tags */}
                  {availableTags.map(tag => (
                    <div key={tag.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`tag-${tag.id}`}
                        checked={cardTagSettings.selectedTagIds.includes(tag.id)}
                        onChange={() => toggleTagSelection(tag.id)}
                        className="w-4 h-4 rounded border-border"
                      />
                      <label htmlFor={`tag-${tag.id}`} className="text-sm cursor-pointer flex items-center gap-2">
                        <span 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: tag.color }}
                        ></span>
                        {tag.name}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex gap-2 pt-2 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCardTagSettings(prev => ({ 
                    ...prev, 
                    selectedTagIds: availableTags.map(t => t.id),
                    includeUntagged: true 
                  }))}
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCardTagSettings(prev => ({ 
                    ...prev, 
                    selectedTagIds: [],
                    includeUntagged: false 
                  }))}
                >
                  Clear All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCardTagSettings(prev => ({ 
                    ...prev, 
                    selectedTagIds: availableTags
                      .filter(t => t.name.toLowerCase() !== 'margin')
                      .map(t => t.id),
                    includeUntagged: false 
                  }))}
                >
                  Reset Default
                </Button>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <Button onClick={closeCardSettings}>Done</Button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="spinner w-10 h-10 border-3 border-primary border-t-transparent rounded-full" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-background">
      <Header 
        theme={theme}
        onThemeChange={setTheme}
        onImportSuccess={handleImportSuccess} 
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        selectedAccounts={selectedAccounts}
        onAccountsChange={handleAccountsChange}
        selectedPeriod={selectedPeriod}
        onPeriodChange={handlePeriodChange}
        customDateRange={customDateRange}
        onCustomDateChange={handleCustomDateChange}
        dataEndDate={dataEndDate}
        onAccountsChanged={loadAccounts}
      />

      <main ref={mainContentRef} className="container mx-auto px-4 py-6">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Card Visibility Toggle */}
        <div className="mb-4 flex justify-end gap-2">
          <SnapshotButton targetRef={mainContentRef} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCardSettings(!showCardSettings)}
            className="flex items-center gap-2"
          >
            <Settings2 className="h-4 w-4" />
            {showCardSettings ? 'Hide Settings' : 'Show/Hide Cards'}
          </Button>
        </div>

        {showCardSettings && (
          <div className="mb-6 p-4 bg-card border border-border rounded-lg">
            <h4 className="text-sm font-medium mb-3">Visible Cards</h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(visibleCards).map(([key, visible]) => {
                const labelMap: Record<string, string> = {
                  maeMfe: 'MAE/MFE Analysis',
                  cumulativePnl: 'Cumulative P&L',
                  drawdown: 'Drawdown',
                  weeklyPnl: 'Weekly P&L',
                  symbolPnl: 'P&L by Symbol',
                  entryHourPnl: 'P&L by Entry Hour',
                  openTrades: 'Open Positions',
                  expectancy: 'Expectancy',
                  sharpe: 'Sharpe Ratio',
                  sortino: 'Sortino Ratio',
                  streak: 'Streak',
                  intraday: 'Intraday',
                  duration: 'Duration',
                  tagPnl: 'P&L by Tag',
                  winRateByEntryHour: 'Win % by Entry Hour'
                };
                return (
                  <Button
                    key={key}
                    variant={visible ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleCard(key as CardKey)}
                    className="flex items-center gap-2"
                  >
                    {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    {labelMap[key] || key.charAt(0).toUpperCase() + key.slice(1)}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {/* Top Row - Key Metrics */}
        <div className="flex flex-wrap gap-4 mb-6">
          {/* Expectancy Card */}
          <CardWrapper cardKey="expectancy" className="w-full lg:w-[calc(33.333%-11px)]">
            <MetricCard
              title="Expectancy per Trade"
              value={formatCurrency(expectancyStats.expectancy)}
              tooltip="Average profit/loss per trade"
              valueClassName={expectancyStats.expectancy >= 0 ? 'text-profit' : 'text-loss'}
              headerAction={
                <button
                  onClick={() => openCardSettings('expectancy')}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title="Card settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
              }
              subtitle={
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-muted-foreground">Rating</span>
                    <span className={expectancyStats.expectancy > 0 ? 'text-profit' : 'text-loss'}>
                      {expectancyStats.expectancy > 10 ? 'Excellent' : expectancyStats.expectancy > 5 ? 'Good' : expectancyStats.expectancy > 0 ? 'Fair' : 'Poor'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Win Contribution</span>
                      <span className="text-profit">${expectancyStats.avgWin.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Loss Contribution</span>
                      <span className="text-loss">${Math.abs(expectancyStats.avgLoss).toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-border grid grid-cols-4 gap-2 text-center">
                    <div>
                      <div className="text-xs text-muted-foreground">Win Rate</div>
                      <div className="text-sm font-medium text-profit">{expectancyStats.winRate.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Loss Rate</div>
                      <div className="text-sm font-medium text-loss">{expectancyStats.lossRate.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Avg Win</div>
                      <div className="text-sm font-medium text-profit">${expectancyStats.avgWin.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Avg Loss</div>
                      <div className="text-sm font-medium text-loss">${Math.abs(expectancyStats.avgLoss).toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              }
            />
          </CardWrapper>

          {/* Sharpe Ratio Card */}
          <CardWrapper cardKey="sharpe" className="w-full lg:w-[calc(33.333%-11px)]">
            <MetricCard
              title="Sharpe Ratio"
              value={stats.sharpe_ratio.toFixed(2)}
              tooltip="Risk-adjusted return measure"
              valueClassName={stats.sharpe_ratio > 1 ? 'text-profit' : 'text-muted-foreground'}
              headerAction={
                <button
                  onClick={() => openCardSettings('sharpe')}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title="Card settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
              }
              subtitle={
                <div className="mt-3">
                  <div className="grid grid-cols-2 gap-4 mb-3">
                    <div>
                      <div className="text-xs text-muted-foreground">Annual Return</div>
                      <div className="text-sm font-medium text-profit">
                        {((stats.net_pnl / (stats.total_trades || 1)) * 252 / 100).toFixed(2)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Volatility</div>
                      <div className="text-sm font-medium">{(stats.sharpe_ratio * 0.02).toFixed(2)}%</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Poor</span>
                    <span>Fair</span>
                    <span>Good</span>
                    <span>Excellent</span>
                  </div>
                  <div className="mt-1 h-2 bg-secondary rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary progress-bar"
                      style={{ width: `${Math.min((stats.sharpe_ratio / 3) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              }
            />
          </CardWrapper>

          {/* Sortino Ratio Card */}
          <CardWrapper cardKey="sortino" className="w-full lg:w-[calc(33.333%-11px)]">
            <MetricCard
              title="Sortino Ratio"
              value={sortinoStats.error ? '—' : sortinoStats.sortino_ratio.toFixed(2)}
              tooltip="Daily P&L versus each account's benchmark. Annual percentages are compounded into daily rates over 252 trading days and applied to starting value plus prior realized P&L. The displayed ratio is not annualized."
              valueClassName={sortinoStats.sortino_ratio > 2 ? 'text-profit' : 'text-muted-foreground'}
              headerAction={
                <button
                  onClick={() => openCardSettings('sortino')}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title="Card settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
              }
              subtitle={
                <div className="mt-3">
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div>
                      <div className="text-xs text-muted-foreground">Avg Daily</div>
                      <div className="text-sm font-medium text-profit">
                        {formatCurrency(sortinoStats.avgDailyReturn)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Avg Daily Target</div>
                      <div className="text-sm font-medium">{sortinoStats.error ? '—' : formatCurrency(sortinoStats.dailyTarget)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Downside Dev</div>
                      <div className="text-sm font-medium">{formatCurrency(sortinoStats.downsideRisk)}</div>
                    </div>
                  </div>
                  {sortinoStats.error && <p role="status" className="mb-3 text-xs text-amber-600 dark:text-amber-400">{sortinoStats.error}</p>}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Poor</span>
                    <span>Fair</span>
                    <span>Good</span>
                    <span>Excellent</span>
                  </div>
                  <div className="mt-1 h-2 bg-secondary rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary progress-bar"
                      style={{ width: `${Math.max(0, Math.min((sortinoStats.sortino_ratio / 4) * 100, 100))}%` }}
                    />
                  </div>
                </div>
              }
            />
          </CardWrapper>
        </div>

        {/* Second Row - Streak, Intraday, Duration */}
        <div className="flex flex-wrap gap-4 mb-6">
          {/* Streak Analysis */}
          <CardWrapper cardKey="streak" className="w-full lg:w-[calc(33.333%-11px)]">
            <StreakMetricCard
              title="Streak Analysis"
              longestWin={stats.longest_win_streak}
              longestWinAmount={stats.longest_win_streak_amount || stats.avg_win * stats.longest_win_streak}
              longestLoss={stats.longest_loss_streak}
              longestLossAmount={stats.longest_loss_streak_amount || stats.avg_loss * stats.longest_loss_streak}
              currentStreak={stats.current_streak}
              currentStreakType={stats.current_streak_type}
              tooltip="Consecutive winning/losing days"
            />
          </CardWrapper>

          {/* Intraday Activity */}
          <CardWrapper cardKey="intraday" className="w-full lg:w-[calc(33.333%-11px)]">
            <div className="bg-card border border-border rounded-lg p-4 h-full flex flex-col">
              <CardHeaderWithTooltip 
                title="Intraday Activity" 
                tooltip="Trading activity by hour of day"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {hourlyData.reduce((sum, h) => sum + h.value, 0)} trades
                  </span>
                  <button
                    onClick={() => openCardSettings('intraday')}
                    className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="Card settings"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </div>
              </CardHeaderWithTooltip>
              <div className="flex-1 min-h-0 flex flex-col">
                {hourlyData.length > 0 ? (
                  <>
                    <div className="flex-1 min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={hourlyData}
                              cx="50%"
                              cy="50%"
                              innerRadius={45}
                              outerRadius={75}
                              paddingAngle={2}
                              dataKey="value"
                            >
                              {hourlyData.map((entry, index) => (
                                <Cell 
                                  key={`cell-${index}`} 
                                  fill={entry.pnl >= 0 ? 'hsl(var(--profit))' : 'hsl(var(--loss))'} 
                                  stroke="hsl(var(--card))"
                                  strokeWidth={2}
                                />
                              ))}
                            </Pie>
                            <RechartsTooltip 
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload;
                                  return (
                                    <div style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                      <p className="font-medium text-foreground">{data.name}</p>
                                      <p className="text-sm text-muted-foreground">{data.value} trades</p>
                                      <p className={`text-sm font-medium ${data.pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                        {data.pnl >= 0 ? '+' : ''}{formatCurrency(data.pnl)}
                                      </p>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pt-2">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          Profitable hour
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-red-500"></span>
                          Losing hour
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                      No hourly data available
                    </div>
                  )}
              </div>
            </div>
          </CardWrapper>

          {/* Duration Analysis */}
          <CardWrapper cardKey="duration" className="w-full lg:w-[calc(33.333%-11px)]">
            <div className="bg-card border border-border rounded-lg p-4 h-full flex flex-col">
              <CardHeaderWithTooltip 
                title="Duration Analysis" 
                tooltip="Trade duration analysis showing P&L by time held"
              >
                <button
                  onClick={() => openCardSettings('duration')}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title="Card settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </CardHeaderWithTooltip>
              <div className="flex-1 min-h-0">
                {durationPnlData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={durationPnlData} margin={{ bottom: 5, left: 20, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis 
                        dataKey="bucket"
                        tick={{ fontSize: 10 }}
                        angle={-45}
                        textAnchor="end"
                        interval={0}
                        height={50}
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => `$${value.toFixed(0)}`}
                      />
                      <RechartsTooltip 
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                <p className="font-medium text-foreground">{label}</p>
                                <p className={`text-sm font-medium ${data.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                                  {formatCurrency(data.pnl)} ({data.count} trades)
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar 
                        dataKey="pnl" 
                        fill="hsl(var(--profit))"
                        radius={[4, 4, 0, 0]}
                      >
                        {durationPnlData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? 'hsl(var(--profit))' : 'hsl(var(--loss))'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    No duration data available
                  </div>
                )}
              </div>
            </div>
          </CardWrapper>

          {/* Tag P&L Analysis */}
          <CardWrapper cardKey="tagPnl" className="w-full lg:w-[calc(33.333%-11px)]">
            <div className="bg-card border border-border rounded-lg p-4 h-full flex flex-col">
              <CardHeaderWithTooltip 
                title="P&L by Tag" 
                tooltip="Trade P&L grouped by tags"
              >
                <span className="text-sm text-muted-foreground">
                  {tagPnlData.length} {tagPnlData.length === 1 ? 'bucket' : 'buckets'}
                </span>
              </CardHeaderWithTooltip>
              <div className="flex-1 min-h-[200px]">
                {tagPnlData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={tagPnlData} margin={{ bottom: 5, left: 20, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis 
                        dataKey="tag"
                        tick={{ fontSize: 10 }}
                        angle={-45}
                        textAnchor="end"
                        interval={0}
                        height={60}
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => `$${value.toFixed(0)}`}
                      />
                      <RechartsTooltip 
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                <p className="font-medium text-foreground">{data.tag}</p>
                                <p className={`text-sm font-medium ${data.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                                  {formatCurrency(data.pnl)} ({data.count} trades)
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar 
                        dataKey="pnl" 
                        radius={[4, 4, 0, 0]}
                      >
                        {tagPnlData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? 'hsl(var(--profit))' : 'hsl(var(--loss))'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    No tagged trades
                  </div>
                )}
              </div>
            </div>
          </CardWrapper>

          {/* Entry Hour P&L Histogram */}
          <CardWrapper cardKey="entryHourPnl" className="w-full lg:w-[calc(33.333%-11px)]">
            <div className="bg-card border border-border rounded-lg p-4 h-full flex flex-col">
              <CardHeaderWithTooltip 
                title="P&L by Entry Hour" 
                tooltip="Profit/loss grouped by trade entry hour of day"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Intraday trades only</span>
                  <button
                    onClick={() => openCardSettings('entryHourPnl')}
                    className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="Card settings"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </div>
              </CardHeaderWithTooltip>
              <div className="flex-1 min-h-[200px]">
                {entryHourPnlData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={entryHourPnlData} margin={{ bottom: 5, left: 20, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis 
                        dataKey="hour"
                        tick={{ fontSize: 10 }}
                        interval={0}
                        height={30}
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => `$${value.toFixed(0)}`}
                      />
                      <RechartsTooltip 
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                <p className="font-medium text-foreground">{label}</p>
                                <p className={`text-sm font-medium ${data.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                                  {formatCurrency(data.pnl)}
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar 
                        dataKey="pnl" 
                        fill="hsl(var(--profit))"
                        radius={[4, 4, 0, 0]}
                      >
                        {entryHourPnlData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? 'hsl(var(--profit))' : 'hsl(var(--loss))'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    No data available
                  </div>
                )}
              </div>
            </div>
          </CardWrapper>

          {/* Win % by Entry Hour */}
          <CardWrapper cardKey="winRateByEntryHour" className="w-full lg:w-[calc(33.333%-11px)]">
            <div className="bg-card border border-border rounded-lg p-4 h-full flex flex-col">
              <CardHeaderWithTooltip 
                title="Win % by Entry Hour" 
                tooltip="Win rate percentage grouped by trade entry hour"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {winRateByEntryHourData.reduce((sum, h) => sum + h.total, 0)} trades
                  </span>
                  <button
                    onClick={() => openCardSettings('winRateByEntryHour')}
                    className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="Card settings"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </div>
              </CardHeaderWithTooltip>
              <div className="flex-1 min-h-[200px]">
                {winRateByEntryHourData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={winRateByEntryHourData} margin={{ bottom: 5, left: 20, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis 
                        dataKey="hour"
                        tick={{ fontSize: 10 }}
                        interval={0}
                        height={30}
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => `${value.toFixed(0)}%`}
                        domain={[0, 100]}
                      />
                      <RechartsTooltip 
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                <p className="font-medium text-foreground">{label}</p>
                                <p className={`text-sm font-medium ${data.winRate >= 50 ? 'text-profit' : 'text-loss'}`}>
                                  {data.winRate.toFixed(1)}% Win Rate
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {data.wins} / {data.total} trades
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar 
                        dataKey="winRate" 
                        fill="hsl(var(--profit))"
                        radius={[4, 4, 0, 0]}
                      >
                        {winRateByEntryHourData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.winRate >= 50 ? 'hsl(var(--profit))' : 'hsl(var(--loss))'} 
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    No data available
                  </div>
                )}
              </div>
            </div>
          </CardWrapper>
        </div>

        {/* Charts Row - Cumulative P&L, Weekly P&L, Symbol P&L, Entry Hour P&L */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 grid-flow-dense auto-rows-min">
          {/* Cumulative P&L Line Chart */}
          <CardWrapper cardKey="cumulativePnl" className="w-full">
            <div className="bg-card border border-border rounded-lg p-4">
              <CardHeaderWithTooltip 
                title="Cumulative P&L" 
                tooltip="Running total of profit/loss over time"
              >
                <span className="text-sm text-muted-foreground">
                  {cumulativePnlData.length > 0 && formatCurrency(cumulativePnlData[cumulativePnlData.length - 1]?.cumulative || 0)}
                </span>
              </CardHeaderWithTooltip>
              <div className="h-64">
                {cumulativePnlData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={cumulativePnlData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fontSize: 12 }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis 
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value) => `$${value.toFixed(0)}`}
                      />
                      <RechartsTooltip 
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                <p className="font-medium text-foreground">{label}</p>
                                <p className={`text-sm ${data.cumulative >= 0 ? 'text-profit' : 'text-loss'}`}>
                                  Cumulative: {formatCurrency(data.cumulative)}
                                </p>
                                <p className={`text-sm ${data.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                                  Daily: {formatCurrency(data.pnl)}
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="cumulative" 
                        stroke="#22c55e" 
                        strokeWidth={2}
                        dot={false}
                        name="cumulative"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    No data available
                  </div>
                )}
              </div>
            </div>
          </CardWrapper>

          {/* Drawdown Chart */}
          <CardWrapper cardKey="drawdown" className="w-full">
            <div className="bg-card border border-border rounded-lg p-4">
              <CardHeaderWithTooltip 
                title="Drawdown" 
                tooltip="Underwater chart showing depth and duration of drawdowns from peak equity"
              >
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>Max: {formatCurrency(maxDrawdown)}</span>
                  <span>{maxDaysToRecover} days to recover</span>
                </div>
              </CardHeaderWithTooltip>
              <div className="h-64">
                {drawdownData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={drawdownData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fontSize: 12 }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis 
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value) => `$${Math.abs(value).toFixed(0)}`}
                        domain={[Math.floor(maxDrawdown / 500) * 500 - 500, 100]}
                        ticks={(() => {
                          const minVal = Math.floor(maxDrawdown / 500) * 500 - 500;
                          const ticks: number[] = [0];
                          for (let v = -500; v >= minVal; v -= 500) {
                            ticks.push(v);
                          }
                          return ticks;
                        })()}
                      />
                      <RechartsTooltip 
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            const dd = data.drawdown;
                            return (
                              <div style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                <p className="font-medium text-foreground">{label}</p>
                                {dd === 0 ? (
                                  <p className="text-sm text-profit">New High</p>
                                ) : (
                                  <p className="text-sm text-loss">
                                    Drawdown: {formatCurrency(Math.abs(dd))}
                                  </p>
                                )}
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <ReferenceLine y={0} stroke="#22c55e" strokeWidth={2} />
                      <Area
                        type="monotone"
                        dataKey="drawdown"
                        stroke="hsl(var(--loss))"
                        fill="hsl(var(--loss))"
                        fillOpacity={0.3}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    No data available
                  </div>
                )}
              </div>
            </div>
          </CardWrapper>

          {/* Weekly/Monthly P&L Histogram */}
          <CardWrapper cardKey="weeklyPnl" className="w-full">
            <div className="bg-card border border-border rounded-lg p-4">
              <CardHeaderWithTooltip 
                title={pnlHistogramView === 'weekly' ? 'Weekly P&L' : 'Monthly P&L'} 
                tooltip={pnlHistogramView === 'weekly' ? 'Profit/loss aggregated by week' : 'Profit/loss aggregated by month'}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {pnlHistogramView === 'weekly' ? 'Last 12 weeks' : 'Last 12 months'}
                  </span>
                  <button
                    onClick={() => setPnlHistogramView(v => v === 'weekly' ? 'monthly' : 'weekly')}
                    className="p-1.5 rounded bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title={pnlHistogramView === 'weekly' ? 'Switch to monthly view' : 'Switch to weekly view'}
                  >
                    {pnlHistogramView === 'weekly' ? <CalendarDays className="h-4 w-4" /> : <CalendarRange className="h-4 w-4" />}
                  </button>
                </div>
              </CardHeaderWithTooltip>
              <div className="h-64">
                {(pnlHistogramView === 'weekly' ? weeklyPnlData : monthlyPnlData).length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pnlHistogramView === 'weekly' ? weeklyPnlData : monthlyPnlData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis 
                        dataKey={pnlHistogramView === 'weekly' ? 'week' : 'month'}
                        tick={{ fontSize: 11 }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis 
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value) => `$${value.toFixed(0)}`}
                      />
                      <RechartsTooltip 
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                <p className="font-medium text-foreground">{pnlHistogramView === 'weekly' ? 'Week' : 'Month'} {label}</p>
                                <p className={`text-sm font-medium ${data.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                                  {formatCurrency(data.pnl)}
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar 
                        dataKey="pnl" 
                        fill="hsl(var(--profit))"
                        radius={[4, 4, 0, 0]}
                      >
                        {(pnlHistogramView === 'weekly' ? weeklyPnlData : monthlyPnlData).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? 'hsl(var(--profit))' : 'hsl(var(--loss))'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    No data available
                  </div>
                )}
              </div>
            </div>
          </CardWrapper>

          {/* Symbol P&L Histogram */}
          <CardWrapper cardKey="symbolPnl" className="w-full">
            <div className="bg-card border border-border rounded-lg p-4">
              <CardHeaderWithTooltip 
                title="P&L by Symbol" 
                tooltip="Total profit/loss grouped by symbol"
              >
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={excludeSPX}
                      onChange={(e) => setExcludeSPX(e.target.checked)}
                      className="rounded border-border bg-background text-primary focus:ring-primary"
                    />
                    Exclude SPX
                  </label>
                  <span className="text-sm text-muted-foreground">{symbolPnlData.length} symbols</span>
                </div>
              </CardHeaderWithTooltip>
              <div className="h-64">
                {symbolPnlData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={symbolPnlData} margin={{ bottom: 10, left: 5, right: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis 
                        dataKey="symbol"
                        tick={{ fontSize: 10 }}
                        angle={-45}
                        textAnchor="end"
                        interval={0}
                        height={40}
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => `$${value.toFixed(0)}`}
                      />
                      <RechartsTooltip 
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', padding: '8px 12px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                                <p className="font-medium text-foreground">{data.symbol}</p>
                                <p className={`text-sm font-medium ${data.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                                  {formatCurrency(data.pnl)}
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar 
                        dataKey="pnl" 
                        fill="hsl(var(--profit))"
                        radius={[4, 4, 0, 0]}
                      >
                        {symbolPnlData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? 'hsl(var(--profit))' : 'hsl(var(--loss))'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    No data available
                  </div>
                )}
              </div>
            </div>
          </CardWrapper>

        </div>

        {/* Open Trades / Positions - Full Width, Auto-hide when empty */}
        {(data?.open_trades || []).length > 0 && (
          <CardWrapper cardKey="openTrades" className="w-full mb-6">
            <div className="bg-card border border-border rounded-lg p-4">
              <CardHeaderWithTooltip 
                title="Open Trades / Positions" 
                tooltip="Currently open trades and unmatched positions"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {(data?.open_trades || []).length} item{(data?.open_trades || []).length !== 1 ? 's' : ''}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      const accountQuery = selectedAccounts.length === 0
                        ? ''
                        : selectedAccounts.length === 1
                          ? `&account_id=${selectedAccounts[0]}`
                          : `&account_ids=${selectedAccounts.join(',')}`;
                      window.open(`/trades?trade_status=open${accountQuery}`, '_blank');
                    }}
                    title="View open trades"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeaderWithTooltip>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-left py-2 font-medium">P/T</th>
                      <th className="text-left py-2 font-medium">Entry Date</th>
                      <th className="text-left py-2 font-medium">Description / Symbol</th>
                      <th className="text-left py-2 font-medium whitespace-nowrap w-24">Underlying</th>
                      <th className="text-right py-2 font-medium whitespace-nowrap w-20">Side</th>
                      <th className="text-right py-2 font-medium">Qty</th>
                      <th className="text-right py-2 font-medium">P&L</th>
                      <th className="text-right py-2 font-medium whitespace-nowrap pr-8">Asset</th>
                      <th className="text-left py-2 font-medium whitespace-nowrap pl-4">Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.open_trades || []).map((pos) => {
                      // For trades (type='T'), use the trade's side field directly.
                      // For positions (type='P'), derive from quantity sign.
                      const isLong = pos.type === 'T' ? (pos.side === 'LONG') : ((pos.quantity || 0) > 0);
                      const absQty = Math.abs(pos.quantity || 0);
                      const safeValue = (val: string | number | null | undefined) => {
                        if (val == null) return '';
                        if (typeof val === 'string') {
                          const lower = val.toLowerCase();
                          if (lower === 'nan' || lower === 'none' || lower === 'null') return '';
                          // Strip " / nan" suffixes from joined underlying symbols
                          return val.replace(/\s*\/\s*(nan|none|null)\s*$/i, '').replace(/\s*\/\s*(nan|none|null)\s*(?=\/|$)/gi, '');
                        }
                        if (typeof val === 'number' && isNaN(val)) return '';
                        return val;
                      };
                      return (
                        <tr
                          key={pos.id}
                          className="border-b border-border/50 last:border-0 cursor-pointer hover:bg-secondary/50"
                          onClick={() => handleOpenPositionClick(pos)}
                        >
                          <td className="py-2 text-muted-foreground">
                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold ${pos.type === 'T' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                              {pos.type || 'P'}
                            </span>
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {pos.trade_date ? formatDate(pos.trade_date) : ''}
                          </td>
                          <td className="py-2 font-medium">
                            {pos.type === 'T' 
                              ? safeValue(pos.description) 
                              : safeValue(pos.symbol)
                            }
                            {(pos.execution_count || 0) > 1 && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({pos.execution_count} fills)
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-muted-foreground whitespace-nowrap w-24">
                            {safeValue(pos.underlying_symbol)}
                          </td>
                          <td className="py-2 text-right whitespace-nowrap w-20">
                            <span className={isLong ? 'text-profit' : 'text-loss'}>
                              {isLong ? 'LONG' : 'SHORT'}
                            </span>
                          </td>
                          <td className="py-2 text-right">
                            {pos.type === 'T'
                              ? (pos.open_qty != null && !isNaN(pos.open_qty) ? pos.open_qty.toFixed(0) : '')
                              : (!isNaN(absQty) ? absQty.toFixed(0) : '')
                            }
                          </td>
                          <td className={`py-2 text-right ${(pos.open_pnl || 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                            {pos.open_pnl != null && !isNaN(pos.open_pnl) ? formatCurrency(pos.open_pnl) : ''}
                          </td>
                          <td className="py-2 text-right text-muted-foreground whitespace-nowrap pr-8">
                            {safeValue(pos.asset_class)}
                          </td>
                          <td className="py-2 whitespace-nowrap pl-4">
                            <div className="flex flex-wrap gap-1">
                              {(pos.tags || []).map((tag) => (
                                <Badge
                                  key={tag.id}
                                  style={{ backgroundColor: tag.color }}
                                  className="text-white text-xs"
                                >
                                  {tag.name}
                                </Badge>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </CardWrapper>
        )}

        {/* MAE/MFE Analysis */}
        <CardWrapper cardKey="maeMfe" className="w-full">
          <div className="mb-6">
            <div className="bg-card border border-border rounded-lg p-4">
              <CardHeaderWithTooltip 
                title="MAE/MFE Analysis" 
                tooltip="Maximum Adverse Excursion vs Maximum Favorable Excursion analysis"
              />
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 grid-flow-dense">
                <ProgressMetricCard
                  title="MFE Capture"
                  value={`${stats.mfe_capture.toFixed(1)}%`}
                  progress={stats.mfe_capture}
                  progressColor="profit"
                  tooltip="Percentage of maximum favorable excursion captured"
                />
                
                <ProgressMetricCard
                  title="Profits Lost"
                  value={`${(100 - stats.mfe_capture).toFixed(1)}%`}
                  progress={100 - stats.mfe_capture}
                  progressColor="loss"
                  tooltip="Percentage of potential profits left on table"
                />
                
                <MetricCard
                  title="Efficiency Ratio"
                  value={`${stats.efficiency_ratio.toFixed(2)}x`}
                  tooltip="Ratio of actual profit to maximum possible profit"
                  valueClassName={stats.efficiency_ratio > 1 ? 'text-profit' : 'text-loss'}
                />
                
                <ProgressMetricCard
                  title="MAE Recovery"
                  value={`${stats.mae_recovery.toFixed(0)}%`}
                  progress={stats.mae_recovery}
                  progressColor="profit"
                  tooltip="Percentage of adverse excursion recovered"
                />
              </div>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-border">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">R/R Realized</div>
                  <div className="text-lg font-bold">{stats.avg_risk_reward.toFixed(2)}R</div>
                  <div className="text-xs text-muted-foreground">Winning trades only</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Exit Gap</div>
                  <div className="text-lg font-bold text-profit">${stats.exit_gap.toFixed(0)}</div>
                  <div className="text-xs text-muted-foreground">Per trade average</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Avg Risk/Reward</div>
                  <div className="text-lg font-bold">1:{stats.avg_risk_reward.toFixed(1)}</div>
                  <div className="text-xs text-muted-foreground">
                    ${Math.abs(stats.avg_loss).toFixed(0)} / ${stats.avg_win.toFixed(0)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Left on Table</div>
                  <div className="text-lg font-bold text-loss">${stats.left_on_table.toFixed(0)}</div>
                  <div className="text-xs text-muted-foreground">
                    {((stats.left_on_table / (stats.gross_profit || 1)) * 100).toFixed(0)}% of potential
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Good Captures</span>
                  <span className="text-sm font-bold">{stats.good_captures.toFixed(0)}%</span>
                </div>
                <div className="text-xs text-muted-foreground mb-2">&gt;50% MFE capture</div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-profit progress-bar"
                    style={{ width: `${stats.good_captures}%` }}
                  />
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-border">
                <div className="text-sm font-medium mb-3">Win Rate by MAE Threshold</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-muted-foreground w-20">MAE &lt; $50</span>
                    <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-profit" style={{ width: '73%' }} />
                    </div>
                    <span className="text-xs w-12 text-right">73%</span>
                    <span className="text-xs text-muted-foreground w-8">(77)</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-muted-foreground w-20">MAE &lt; $100</span>
                    <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-profit" style={{ width: '80%' }} />
                    </div>
                    <span className="text-xs w-12 text-right">80%</span>
                    <span className="text-xs text-muted-foreground w-8">(127)</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-muted-foreground w-20">MAE &lt; $200</span>
                    <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-profit" style={{ width: '71%' }} />
                    </div>
                    <span className="text-xs w-12 text-right">71%</span>
                    <span className="text-xs text-muted-foreground w-8">(194)</span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Based on {stats.total_trades} trades with MAE/MFE data
                </div>
              </div>
            </div>
          </div>
        </CardWrapper>

        {/* Calendar and Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 grid-flow-dense items-start auto-rows-min">
          <div className="lg:col-span-2 min-w-0">
            <Calendar
              dailyStats={data?.calendar || []}
              journals={journals}
              year={currentDate.getFullYear()}
              month={currentDate.getMonth() + 1}
              onMonthChange={handleMonthChange}
              onDayClick={handleDayClick}
            />
          </div>
          <div className="min-w-0 h-auto">
            <SummaryTable stats={stats} dailyStats={data?.daily} />
          </div>
        </div>
      </main>

      {/* Card Settings Modal */}
      <CardSettingsModal />

      {/* Day Trades Modal */}
      {dayModalOpen && selectedDayDate && (
        <DayTradesModal
          date={selectedDayDate}
          dailyStats={selectedDayStats}
          selectedAccounts={selectedAccounts}
          onClose={() => {
            setDayModalOpen(false);
            setSelectedDayDate(null);
            setSelectedDayStats(null);
          }}
        />
      )}

      {/* Execution Edit Modal */}
      {editingExecution && (
        <ExecutionEditModal
          execution={editingExecution}
          onClose={() => setEditingExecution(null)}
          onSuccess={() => {
            setEditingExecution(null);
            handleRefresh();
          }}
        />
      )}
    </div>
  );
}

export default App;
