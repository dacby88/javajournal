import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/services/api';
import type { Trade, TradesFilter, TradeTag, Account } from '@/types';
import { formatDateTime as formatDateTimeUtil, wrapTradeDescription, parseAccountIdsParam } from '@/lib/utils';
import { 
  Search, 
  Filter, 
  Eye, 
  ChevronLeft, 
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Download,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Link2,
  Calculator,
  AlertTriangle,
  Loader2,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { SimpleNav } from './SimpleNav';
import { DatePicker } from './DatePicker';
import { TagSelector, TagDisplay } from './TagSelector';
import { ConfirmModal } from './ConfirmModal';
import { AccountMultiSelect } from './AccountMultiSelect';

const STORAGE_KEY = 'tradesPageFilters';

export function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Load filters from sessionStorage on mount
  const loadSavedFilters = (): TradesFilter => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Clear old datetime fields that are no longer used
        delete parsed.start_datetime;
        delete parsed.end_datetime;
        return parsed;
      }
    } catch (e) {
      console.error('Failed to load filters:', e);
    }
    return { limit: 50, offset: 0 };
  };
  
  const [filters, setFilters] = useState<TradesFilter>(() => {
    const saved = loadSavedFilters();
    // Check for URL params
    const urlAccountIds = parseAccountIdsParam(searchParams);
    const urlStartDate = searchParams.get('start_date');
    const urlEndDate = searchParams.get('end_date');
    const urlDateFilterMode = searchParams.get('date_filter_mode') as 'exit_date' | 'entry_date' | 'active_date' | null;
    const urlTradeStatus = searchParams.get('trade_status') as 'open' | 'closed' | 'all' | null;
    
    // If any URL filters were applied, build filters from URL (not saved)
    // to avoid stale sessionStorage values (e.g. dates) leaking through
    if (urlAccountIds.length > 0 || urlStartDate || urlEndDate || urlDateFilterMode || urlTradeStatus) {
      const urlFilters: TradesFilter = {
        ...saved,
        start_date: urlStartDate || '',
        end_date: urlEndDate || '',
        date_filter_mode: urlDateFilterMode || 'active_date',
      };
      if (urlAccountIds.length > 0) {
        urlFilters.account_ids = urlAccountIds;
        delete urlFilters.account_id;
      }
      if (urlTradeStatus) {
        urlFilters.trade_status = urlTradeStatus;
      }
      return urlFilters;
    }
    return saved;
  });
  
  const loadSavedTempFilters = () => {
    const urlAccountIds = parseAccountIdsParam(searchParams);
    const urlStartDate = searchParams.get('start_date');
    const urlEndDate = searchParams.get('end_date');
    const urlDateFilterMode = searchParams.get('date_filter_mode') as 'exit_date' | 'entry_date' | 'active_date' | null;
    const urlTradeStatus = searchParams.get('trade_status') as 'open' | 'closed' | 'all' | null;

    // If URL params are present, ignore sessionStorage to avoid stale values
    if (urlAccountIds.length > 0 || urlStartDate || urlEndDate || urlDateFilterMode || urlTradeStatus) {
      return {
        symbol: '',
        underlying: '',
        start_date: urlStartDate || '',
        end_date: urlEndDate || '',
        date_filter_mode: urlDateFilterMode || 'active_date',
        entry_time_start: '',
        entry_time_end: '',
        exit_time_start: '',
        exit_time_end: '',
        duration_min: '',
        duration_max: '',
        side: 'ALL',
        account_ids: urlAccountIds,
        tag_ids: [],
        tag_mode: 'AND',
        trade_status: urlTradeStatus || 'all',
      };
    }

    try {
      const saved = sessionStorage.getItem(`${STORAGE_KEY}_temp`);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Clear old datetime fields that are no longer used
        delete parsed.start_datetime;
        delete parsed.end_datetime;
        return parsed;
      }
    } catch (e) {
      console.error('Failed to load temp filters:', e);
    }
    
    return {
      symbol: '',
      underlying: '',
      start_date: '',
      end_date: '',
      date_filter_mode: 'active_date',
      entry_time_start: '',
      entry_time_end: '',
      exit_time_start: '',
      exit_time_end: '',
      duration_min: '',
      duration_max: '',
      side: 'ALL',
      account_ids: [] as number[],
      tag_ids: [],
      tag_mode: 'AND',
      trade_status: 'all',
    };
  };

  const [tempFilters, setTempFilters] = useState(loadSavedTempFilters);
  const [availableTags, setAvailableTags] = useState<TradeTag[]>([]);
  const [editingTradeId, setEditingTradeId] = useState<number | null>(null);
  const [tradeTags, setTradeTags] = useState<TradeTag[]>([]);
  
  // Trade selection and combination state
  const [selectedTrades, setSelectedTrades] = useState<Set<number>>(new Set());
  const [combineLoading, setCombineLoading] = useState(false);
  const [showCombineConfirm, setShowCombineConfirm] = useState(false);
  const [recalcPnLLoading, setRecalcPnLLoading] = useState(false);
  const [showRecalcPnLConfirm, setShowRecalcPnLConfirm] = useState(false);
  const [recalcPnLConfirmText, setRecalcPnLConfirmText] = useState('');
  const [recalcPnLResult, setRecalcPnLResult] = useState<{updated: number, total_pnl_diff: number} | null>(null);
  const tagEditorRef = useRef<HTMLTableCellElement>(null);
  const [exporting, setExporting] = useState(false);
  
  // Sorting state
  const [sortConfig, setSortConfig] = useState<{ key: string; order: 'asc' | 'desc' } | null>(null);

  // Save filters whenever they change
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  // Close tag editor when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tagEditorRef.current && !tagEditorRef.current.contains(event.target as Node)) {
        setEditingTradeId(null);
      }
    };

    if (editingTradeId !== null) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [editingTradeId]);
  
  useEffect(() => {
    sessionStorage.setItem(`${STORAGE_KEY}_temp`, JSON.stringify(tempFilters));
  }, [tempFilters]);

  // Handle URL params changes - this allows navigation from other pages with filters
  useEffect(() => {
    const urlAccountIds = parseAccountIdsParam(searchParams);
    const urlStartDate = searchParams.get('start_date');
    const urlEndDate = searchParams.get('end_date');
    const urlDateFilterMode = searchParams.get('date_filter_mode') as 'exit_date' | 'entry_date' | 'active_date' | null;
    const urlTradeStatus = searchParams.get('trade_status') as 'open' | 'closed' | 'all' | null;
    
    if (urlAccountIds.length > 0 || urlStartDate || urlEndDate || urlDateFilterMode || urlTradeStatus) {
      // Update filters from URL params
      setFilters(prev => ({
        ...prev,
        ...(urlAccountIds.length > 0 ? { account_ids: urlAccountIds } : {}),
        start_date: urlStartDate || '',
        end_date: urlEndDate || '',
        date_filter_mode: urlDateFilterMode || 'active_date',
        ...(urlTradeStatus ? { trade_status: urlTradeStatus } : {}),
        offset: 0,
      }));
      
      // Also update tempFilters to match
      setTempFilters((prev: typeof tempFilters) => ({
        ...prev,
        ...(urlAccountIds.length > 0 ? { account_ids: urlAccountIds } : {}),
        start_date: urlStartDate || '',
        end_date: urlEndDate || '',
        date_filter_mode: urlDateFilterMode || 'active_date',
        trade_status: urlTradeStatus || 'all',
      }));
    }
  }, [searchParams]);

  const fetchAccounts = useCallback(async () => {
    try {
      const response = await api.getAccounts();
      if (response.success) {
        setAccounts(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
  }, []);

  const fetchTags = useCallback(async () => {
    try {
      const response = await api.getTags();
      if (response.success) {
        setAvailableTags(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch tags:', err);
    }
  }, []);

  const fetchTrades = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const apiFilters: TradesFilter = {
        ...filters,
        side: filters.side === 'ALL' ? undefined : filters.side,
        account_ids: filters.account_ids && filters.account_ids.length > 0 ? filters.account_ids : undefined,
        account_id: undefined,
        tag_ids: filters.tag_ids && filters.tag_ids.length > 0 ? filters.tag_ids : undefined,
      };
      const response = await api.getTrades(apiFilters);
      if (response.success) {
        setTrades(response.data);
        setTotal(response.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch trades');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchAccounts();
    fetchTags();
    fetchTrades();
  }, [fetchAccounts, fetchTags, fetchTrades]);

  const handleApplyFilters = () => {
    setFilters({
      limit: 50,
      offset: 0,
      symbol: tempFilters.symbol || undefined,
      underlying: tempFilters.underlying || undefined,
      start_date: tempFilters.start_date || undefined,
      end_date: tempFilters.end_date || undefined,
      date_filter_mode: tempFilters.date_filter_mode || 'active_date',
      entry_time_start: tempFilters.entry_time_start || undefined,
      entry_time_end: tempFilters.entry_time_end || undefined,
      exit_time_start: tempFilters.exit_time_start || undefined,
      exit_time_end: tempFilters.exit_time_end || undefined,
      duration_min_minutes: tempFilters.duration_min ? parseInt(tempFilters.duration_min) : undefined,
      duration_max_minutes: tempFilters.duration_max ? parseInt(tempFilters.duration_max) : undefined,
      side: tempFilters.side === 'ALL' ? undefined : tempFilters.side,
      account_ids: tempFilters.account_ids && tempFilters.account_ids.length > 0 ? tempFilters.account_ids : undefined,
      tag_ids: tempFilters.tag_ids?.length > 0 ? tempFilters.tag_ids : undefined,
      tag_mode: tempFilters.tag_mode || 'AND',
      trade_status: tempFilters.trade_status || 'all',
    });
  };

  const handleClearFilters = () => {
    const cleared = {
      symbol: '',
      underlying: '',
      start_date: '',
      end_date: '',
      date_filter_mode: 'active_date',
      entry_time_start: '',
      entry_time_end: '',
      exit_time_start: '',
      exit_time_end: '',
      duration_min: '',
      duration_max: '',
      side: 'ALL',
      account_ids: [] as number[],
      tag_ids: [],
      tag_mode: 'AND',
      trade_status: 'all',
    };
    setTempFilters(cleared);
    setFilters({
      limit: 50,
      offset: 0,
    });
  };

  const handleUpdateTradeTags = async (tradeId: number, tags: TradeTag[]) => {
    try {
      const response = await api.setTradeTags(tradeId, tags.map(t => t.id));
      if (response.success) {
        setTrades(prev => prev.map(trade => 
          trade.id === tradeId ? { ...trade, tags: response.data } : trade
        ));
        // Update tradeTags to reflect the saved state
        setTradeTags(response.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tags');
    }
    // Don't close the editor - let user continue editing or click elsewhere
  };

  // Trade selection handlers
  const toggleTradeSelection = (tradeId: number) => {
    setSelectedTrades(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tradeId)) {
        newSet.delete(tradeId);
      } else {
        newSet.add(tradeId);
      }
      return newSet;
    });
  };

  const toggleAllTrades = () => {
    if (selectedTrades.size === trades.length) {
      setSelectedTrades(new Set());
    } else {
      setSelectedTrades(new Set(trades.map(t => t.id)));
    }
  };

  const handleCombineTrades = async () => {
    if (selectedTrades.size < 2) return;
    
    setCombineLoading(true);
    setError(null);
    
    try {
      const response = await api.combineTrades(Array.from(selectedTrades));
      if (response.success) {
        // Clear selection and refresh trades
        setSelectedTrades(new Set());
        setShowCombineConfirm(false);
        await fetchTrades();
      } else {
        setError(response.message || 'Failed to combine trades');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to combine trades');
    } finally {
      setCombineLoading(false);
    }
  };

  // Recalculation is a per-account operation, so fan the request out across the
  // current selection. An empty selection means "every account".
  const recalcAccountIds = filters.account_ids ?? [];
  const recalcTargets: Array<number | undefined> =
    recalcAccountIds.length > 0 ? recalcAccountIds : [undefined];
  const recalcAccountLabel =
    recalcAccountIds.length === 0
      ? 'all accounts'
      : recalcAccountIds.length === 1
        ? `account: ${accounts.find(a => a.id === recalcAccountIds[0])?.name || recalcAccountIds[0]}`
        : `${recalcAccountIds.length} selected accounts`;

  const handleRecalculatePnL = async () => {
    setShowRecalcPnLConfirm(false);
    setRecalcPnLLoading(true);
    setError(null);
    
    try {
      let updated = 0;
      let totalPnlDiff = 0;
      for (const accountId of recalcTargets) {
        const response = await api.recalculateTradePnL(accountId);
        if (response.success && response.data) {
          updated += response.data.updated;
          totalPnlDiff += response.data.total_pnl_diff;
        } else {
          setError(response.message || 'Failed to recalculate P&L');
          return;
        }
      }
      setRecalcPnLResult({ updated, total_pnl_diff: totalPnlDiff });
      await fetchTrades();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recalculate P&L');
    } finally {
      setRecalcPnLLoading(false);
    }
  };

  const handleRecalcStatsAfterPnL = async () => {
    setRecalcPnLResult(null);
    setLoading(true);
    
    try {
      for (const accountId of recalcTargets) {
        const response = await api.recalculateStats(accountId);
        if (!response.success) {
          setError(response.message || 'Failed to recalculate stats');
          return;
        }
      }
      alert('Statistics recalculated successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recalculate stats');
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newOffset: number) => {
    setFilters(prev => ({
      ...prev,
      offset: newOffset,
    }));
  };

  const handleSort = (key: string) => {
    let order: 'asc' | 'desc' = 'asc';
    if (sortConfig?.key === key && sortConfig.order === 'asc') {
      order = 'desc';
    }
    setSortConfig({ key, order });
    setFilters(prev => ({
      ...prev,
      sort_by: key,
      sort_order: order,
    }));
  };

  const getSortIcon = (key: string) => {
    if (sortConfig?.key !== key) {
      return <ArrowUpDown className="h-3 w-3 text-muted-foreground" />;
    }
    return sortConfig.order === 'asc' 
      ? <ArrowUp className="h-3 w-3 text-primary" />
      : <ArrowDown className="h-3 w-3 text-primary" />;
  };

  const handleViewTrade = (tradeId: number) => {
    navigate(`/trades/${tradeId}`);
  };

  const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null) return '-';
    return value >= 0 
      ? `$${value.toFixed(2)}` 
      : `-$${Math.abs(value).toFixed(2)}`;
  };

  const tradeDisplayPnl = (trade: Trade) => {
    if (trade.is_open) {
      return trade.open_pnl != null ? trade.open_pnl : null;
    }
    return trade.net_pnl ?? 0;
  };

  const formatDateTime = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    return formatDateTimeUtil(dateStr) || dateStr;
  };

  const totalPages = Math.ceil(total / (filters.limit || 50));
  const currentPage = Math.floor((filters.offset || 0) / (filters.limit || 50)) + 1;

  return (
    <div className="min-h-screen bg-background">
      <SimpleNav title="Trades" />

      <main className="container mx-auto px-4 py-6">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Symbol</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="e.g., SPXW"
                    value={tempFilters.symbol}
                    onChange={(e) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, symbol: e.target.value }))}
                    className="pl-9"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Underlying</label>
                <Input
                  placeholder="e.g., SPX"
                  value={tempFilters.underlying}
                  onChange={(e) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, underlying: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Side</label>
                <Select
                  value={tempFilters.side}
                  onValueChange={(value: string) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, side: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Sides" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Sides</SelectItem>
                    <SelectItem value="LONG">Long</SelectItem>
                    <SelectItem value="SHORT">Short</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Accounts</label>
                <AccountMultiSelect
                  accounts={accounts}
                  selected={tempFilters.account_ids ?? []}
                  onChange={(ids) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, account_ids: ids }))}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Tags</label>
                  <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => setTempFilters((prev: typeof tempFilters) => ({ ...prev, tag_mode: 'AND' }))}
                      className={`text-xs px-2 py-1 rounded ${tempFilters.tag_mode === 'AND' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                      title="Show trades with ALL selected tags"
                    >
                      AND
                    </button>
                    <button
                      type="button"
                      onClick={() => setTempFilters((prev: typeof tempFilters) => ({ ...prev, tag_mode: 'OR' }))}
                      className={`text-xs px-2 py-1 rounded ${tempFilters.tag_mode === 'OR' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                      title="Show trades with ANY selected tag"
                    >
                      OR
                    </button>
                    <button
                      type="button"
                      onClick={() => setTempFilters((prev: typeof tempFilters) => ({ ...prev, tag_mode: 'NONE' }))}
                      className={`text-xs px-2 py-1 rounded ${tempFilters.tag_mode === 'NONE' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                      title="Show trades with NO tags"
                    >
                      NONE
                    </button>
                  </div>
                </div>
                {tempFilters.tag_mode !== 'NONE' && (
                  <TagSelector
                    selectedTags={availableTags.filter(t => tempFilters.tag_ids?.includes(t.id)) || []}
                    onChange={(tags) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, tag_ids: tags.map(t => t.id) }))}
                  />
                )}
                {tempFilters.tag_mode === 'NONE' && (
                  <div className="text-sm text-muted-foreground py-2">
                    Showing only trades with no tags
                  </div>
                )}
              </div>

              <DatePicker
                label="Start Date"
                date={tempFilters.start_date}
                onChange={(date: string) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, start_date: date }))}
              />

              <DatePicker
                label="End Date"
                date={tempFilters.end_date}
                onChange={(date: string) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, end_date: date }))}
              />

              <div>
                <label className="text-sm font-medium mb-2 block">Date Filter Mode</label>
                <Select
                  value={tempFilters.date_filter_mode || 'active_date'}
                  onValueChange={(value: 'exit_date' | 'entry_date' | 'active_date') => 
                    setTempFilters((prev: typeof tempFilters) => ({ ...prev, date_filter_mode: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exit_date">Exit Date (when trade closed)</SelectItem>
                    <SelectItem value="entry_date">Entry Date (when trade opened)</SelectItem>
                    <SelectItem value="active_date">Active Date (trades open on this day)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Entry Time Start</label>
                <Input
                  type="time"
                  value={tempFilters.entry_time_start}
                  onChange={(e) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, entry_time_start: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Entry Time End</label>
                <Input
                  type="time"
                  value={tempFilters.entry_time_end}
                  onChange={(e) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, entry_time_end: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Exit Time Start</label>
                <Input
                  type="time"
                  value={tempFilters.exit_time_start}
                  onChange={(e) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, exit_time_start: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Exit Time End</label>
                <Input
                  type="time"
                  value={tempFilters.exit_time_end}
                  onChange={(e) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, exit_time_end: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Min Duration (min)</label>
                <Input
                  type="number"
                  placeholder="e.g., 5"
                  value={tempFilters.duration_min}
                  onChange={(e) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, duration_min: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Max Duration (min)</label>
                <Input
                  type="number"
                  placeholder="e.g., 60"
                  value={tempFilters.duration_max}
                  onChange={(e) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, duration_max: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Trade Status</label>
                <div className="flex rounded-md border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setTempFilters((prev: typeof tempFilters) => ({ ...prev, trade_status: 'all' }))}
                    className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors ${
                      tempFilters.trade_status === 'all'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-secondary'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setTempFilters((prev: typeof tempFilters) => ({ ...prev, trade_status: 'open' }))}
                    className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors border-l border-border ${
                      tempFilters.trade_status === 'open'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-secondary'
                    }`}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => setTempFilters((prev: typeof tempFilters) => ({ ...prev, trade_status: 'closed' }))}
                    className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors border-l border-border ${
                      tempFilters.trade_status === 'closed'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-secondary'
                    }`}
                  >
                    Closed
                  </button>
                </div>
              </div>

              <div className="flex items-end gap-2">
                <Button onClick={handleApplyFilters} className="flex-1">
                  <Search className="h-4 w-4 mr-2" />
                  Apply
                </Button>
                <Button onClick={handleClearFilters} variant="outline">
                  Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">
              Showing {trades.length} of {total} trades
            </p>
            {selectedTrades.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{selectedTrades.size} selected</Badge>
                <Button
                  size="sm"
                  onClick={() => setShowCombineConfirm(true)}
                  disabled={selectedTrades.size < 2 || combineLoading}
                >
                  <Link2 className="h-4 w-4 mr-2" />
                  Combine Trades
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedTrades(new Set())}
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={async () => {
                if (accounts.length === 0) {
                  setError('Please create an account first before adding trades.');
                  return;
                }
                const accountId = recalcAccountIds[0] || accounts[0]?.id;
                if (!accountId) return;
                try {
                  const response = await api.createTrade({ account_id: accountId });
                  if (response.success && response.data) {
                    navigate(`/trades/${response.data.id}`);
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to create trade');
                }
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Trade
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRecalcPnLConfirmText('');
                setShowRecalcPnLConfirm(true);
              }}
              disabled={recalcPnLLoading || trades.length === 0}
              title={`Recalculate P&L for ALL trades in ${recalcAccountLabel}`}
            >
              <Calculator className="h-4 w-4 mr-2" />
              {recalcPnLLoading ? 'Recalculating...' : 'Recalc P&L'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (trades.length === 0) return;
                try {
                  setExporting(true);
                  const apiFilters: TradesFilter = {
                    ...filters,
                    limit: total || 100000,
                    offset: 0,
                    side: filters.side === 'ALL' ? undefined : filters.side,
                    account_ids: recalcAccountIds.length > 0 ? recalcAccountIds : undefined,
                    account_id: undefined,
                    tag_ids: filters.tag_ids && filters.tag_ids.length > 0 ? filters.tag_ids : undefined,
                  };
                  const response = await api.getTrades(apiFilters);
                  if (response.success) {
                    const allTrades = response.data;
                    const headers = ['ID', 'Entry Time', 'Exit Time', 'Account', 'Symbol', 'Side', 'Qty', 'Entry Price', 'Exit Price', 'P&L', 'Net Cash'];
                    const rows = allTrades.map(t => [
                      t.id,
                      t.entry_time || t.entry_date,
                      t.exit_time || t.exit_date || '',
                      accounts.find(a => a.id === t.account_id)?.name || t.account_id,
                      t.symbol,
                      t.side,
                      t.quantity,
                      t.entry_price,
                      t.exit_price || '',
                      t.is_open ? (t.open_pnl ?? '') : t.net_pnl,
                      t.net_cash
                    ]);
                    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `trades_${new Date().toISOString().split('T')[0]}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }
                } catch (err) {
                  console.error('Failed to export trades:', err);
                } finally {
                  setExporting(false);
                }
              }}
              disabled={trades.length === 0 || exporting}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {exporting ? 'Exporting...' : 'Export CSV'}
            </Button>
          </div>
        </div>

        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedTrades.size === trades.length && trades.length > 0}
                      onCheckedChange={toggleAllTrades}
                      aria-label="Select all trades"
                    />
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('id')}>
                    <div className="flex items-center gap-1">ID {getSortIcon('id')}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('entry_date')}>
                    <div className="flex items-center gap-1">Entry Time {getSortIcon('entry_date')}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('exit_date')}>
                    <div className="flex items-center gap-1">Exit Time {getSortIcon('exit_date')}</div>
                  </TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="max-w-[18rem] w-[18rem] cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('description')}>
                    <div className="flex items-center gap-1">Description {getSortIcon('description')}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('side')}>
                    <div className="flex items-center gap-1">Side {getSortIcon('side')}</div>
                  </TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="text-right cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('quantity')}>
                    <div className="flex items-center justify-end gap-1">TQ/OQ {getSortIcon('quantity')}</div>
                  </TableHead>
                  <TableHead className="text-right cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('net_pnl')}>
                    <div className="flex items-center justify-end gap-1">P&L {getSortIcon('net_pnl')}</div>
                  </TableHead>
                  <TableHead className="text-right">Net Cash</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8">
                      <div className="flex items-center justify-center gap-2">
                        <div className="spinner w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        Loading...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : trades.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                      No trades found
                    </TableCell>
                  </TableRow>
                ) : (
                  trades.map((trade) => {
                    const pnl = tradeDisplayPnl(trade);
                    return (
                    <TableRow 
                      key={trade.id}
                      className="cursor-pointer hover:bg-secondary/50"
                      onClick={() => handleViewTrade(trade.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedTrades.has(trade.id)}
                          onCheckedChange={() => toggleTradeSelection(trade.id)}
                          aria-label={`Select trade ${trade.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{trade.id}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(trade.entry_time || trade.entry_date)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(trade.exit_time || trade.exit_date)}
                      </TableCell>
                      <TableCell>{trade.account_name || '-'}</TableCell>
                      <TableCell className="font-medium max-w-[18rem] w-[18rem] whitespace-normal break-words align-top">
                        {wrapTradeDescription(trade.description || trade.symbol || '-')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={trade.side === 'LONG' ? 'default' : 'secondary'}>
                          {trade.side}
                        </Badge>
                      </TableCell>
                      <TableCell 
                        onClick={(e) => e.stopPropagation()}
                        ref={editingTradeId === trade.id ? tagEditorRef : null}
                      >
                        {editingTradeId === trade.id ? (
                          <div className="min-w-[200px]">
                            <TagSelector
                              selectedTags={tradeTags}
                              onChange={(tags) => handleUpdateTradeTags(trade.id, tags)}
                            />
                          </div>
                        ) : (
                          <div
                            className="cursor-pointer hover:bg-secondary/50 p-1 rounded"
                            onClick={() => {
                              setEditingTradeId(trade.id);
                              setTradeTags(trade.tags || []);
                            }}
                          >
                            <TagDisplay tags={trade.tags || []} />
                            {(!trade.tags || trade.tags.length === 0) && (
                              <span className="text-xs text-muted-foreground">Add tags</span>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {(() => {
                          const tq = trade.quantity != null && !isNaN(trade.quantity)
                            ? Number(trade.quantity).toFixed(0)
                            : '-';
                          const oq = trade.open_qty != null && !isNaN(trade.open_qty)
                            ? Number(trade.open_qty).toFixed(0)
                            : '-';
                          return `${tq} / ${oq}`;
                        })()}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-medium ${
                        pnl == null
                          ? 'text-muted-foreground'
                          : (pnl >= 0 ? 'text-profit' : 'text-loss')
                      }`}>
                        <div className="flex items-center justify-end gap-1">
                          {pnl == null ? (
                            formatCurrency(null)
                          ) : (
                            <>
                              {pnl >= 0 ? (
                                <TrendingUp className="h-3 w-3" />
                              ) : (
                                <TrendingDown className="h-3 w-3" />
                              )}
                              {formatCurrency(pnl)}
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={`text-right font-mono ${(trade.net_cash || 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                        {formatCurrency(trade.net_cash)}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewTrade(trade.id)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {total > 0 && (
            <div className="border-t border-border p-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange((filters.offset || 0) - (filters.limit || 50))}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange((filters.offset || 0) + (filters.limit || 50))}
                  disabled={currentPage >= totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Combine Confirmation Modal */}
        <ConfirmModal
          isOpen={showCombineConfirm}
          onCancel={() => setShowCombineConfirm(false)}
          onConfirm={handleCombineTrades}
          title="Combine Trades"
          message={`Are you sure you want to combine ${selectedTrades.size} trades into a single trade? This action will merge all executions and recalculate entry/exit times, quantities, and P&L. You can undo this later if needed.`}
          confirmText={combineLoading ? 'Combining...' : 'Combine'}
        />

        {/* Recalculate P&L Confirmation Modal with Text Input */}
        {showRecalcPnLConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <Card className="w-full max-w-md">
              <CardHeader className="border-b bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5" />
                  <CardTitle className="text-lg">Recalculate P&L</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="text-muted-foreground space-y-2">
                  <p>
                    {recalcAccountIds.length > 0
                      ? <>This will recalculate P&L for <strong>ALL trades</strong> in <strong>{recalcAccountIds.length === 1 ? <>account <strong>"{recalcAccountLabel.replace('account: ', '')}"</strong></> : <>{recalcAccountIds.length} selected accounts</>}</strong>.</>
                      : <>This will recalculate P&L for <strong>ALL trades</strong> in <strong>ALL accounts</strong>.</>
                    }
                  </p>
                  <p className="text-sm">
                    This affects all trades for {recalcAccountIds.length > 0 ? 'these accounts' : 'all accounts'}, not just the ones visible on the current page.
                  </p>
                </div>
                <div className="bg-muted p-3 rounded-md text-sm space-y-2">
                  <p className="font-medium">To confirm, type <code className="bg-background px-1.5 py-0.5 rounded text-xs">RECALC</code> below:</p>
                  <Input
                    value={recalcPnLConfirmText}
                    onChange={(e) => setRecalcPnLConfirmText(e.target.value)}
                    placeholder="Type RECALC to confirm"
                    className="uppercase"
                    autoFocus
                  />
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setShowRecalcPnLConfirm(false)}>
                  Cancel
                </Button>
                <Button 
                  className="bg-yellow-500 hover:bg-yellow-500/90 text-black"
                  onClick={handleRecalculatePnL}
                  disabled={recalcPnLConfirmText !== 'RECALC' || recalcPnLLoading}
                >
                  {recalcPnLLoading ? 'Recalculating...' : 'Recalculate P&L'}
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}

        {/* Recalculate Stats After P&L Modal */}
        <ConfirmModal
          isOpen={!!recalcPnLResult}
          onCancel={() => setRecalcPnLResult(null)}
          onConfirm={handleRecalcStatsAfterPnL}
          title="P&L Recalculation Complete"
          message={recalcPnLResult 
            ? `Updated ${recalcPnLResult.updated} trades.\nTotal P&L change: $${recalcPnLResult.total_pnl_diff.toFixed(2)}\n\nWould you like to recalculate statistics now? This will update daily stats, overall stats, and all aggregated metrics.`
            : ''
          }
          confirmText="Recalculate Stats"
          cancelText="Skip"
        />
      </main>
    </div>
  );
}
