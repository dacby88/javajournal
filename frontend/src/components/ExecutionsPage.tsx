import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import type { Execution, ExecutionsFilter, Trade, Account } from '@/types';
import { formatDateTime as formatDateTimeUtil, formatDate, parseAccountIdsParam } from '@/lib/utils';
import { 
  Search, 
  Filter, 
  Edit2, 
  Trash2, 
  ChevronLeft, 
  ChevronRight,
  Download,
  Plus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Link2,
  ExternalLink,
  Loader2,
  ArrowRight,
  Split,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { ExecutionEditModal } from './ExecutionEditModal';
import { ExecutionAddModal } from './ExecutionAddModal';
import { ExecutionSplitModal } from './ExecutionSplitModal';
import { SimpleNav } from './SimpleNav';
import { ConfirmModal } from './ConfirmModal';
import { DatePicker } from './DatePicker';
import { AccountMultiSelect } from './AccountMultiSelect';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const STORAGE_KEY = 'executionsPageFilters';

export function ExecutionsPage() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [editingExecution, setEditingExecution] = useState<Execution | null>(null);
  const [splittingExecution, setSplittingExecution] = useState<Execution | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // Load filters from sessionStorage on mount
  const loadSavedFilters = (): ExecutionsFilter => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load filters:', e);
    }
    return { limit: 50, offset: 0 };
  };
  
  const [filters, setFilters] = useState<ExecutionsFilter>(() => {
    const saved = loadSavedFilters();
    // Check for account selection in URL params
    const urlAccountIds = parseAccountIdsParam(searchParams);
    if (urlAccountIds.length > 0) {
      return { ...saved, account_ids: urlAccountIds };
    }
    return saved;
  });
  
  const loadSavedTempFilters = () => {
    const urlAccountIds = parseAccountIdsParam(searchParams);
    const urlMatched = searchParams.get('matched');
    try {
      const saved = sessionStorage.getItem(`${STORAGE_KEY}_temp`);
      if (saved) {
        const parsed = JSON.parse(saved);
        // URL account selection wins over anything stored
        if (urlAccountIds.length > 0) {
          parsed.account_ids = urlAccountIds;
          delete parsed.account_id;
        }
        // Check for matched in URL params
        if (urlMatched !== null) {
          parsed.matched = urlMatched === 'true' ? 'true' : urlMatched === 'false' ? 'false' : 'ALL';
        }
        return parsed;
      }
    } catch (e) {
      console.error('Failed to load temp filters:', e);
    }
    // Check for account selection and matched in URL params
    return {
      symbol: '',
      underlying: '',
      start_date: '',
      end_date: '',
      entry_time_start: '',
      entry_time_end: '',
      side: 'ALL',
      asset_class: 'ALL',
      account_ids: urlAccountIds,
      matched: urlMatched === 'true' ? 'true' : urlMatched === 'false' ? 'false' : 'ALL',
    };
  };
  
  const [tempFilters, setTempFilters] = useState(loadSavedTempFilters);
  
  // Delete confirmation state
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    executionId: number | null;
    isPartOfTrade: boolean;
    isDeleting: boolean;
  }>({ isOpen: false, executionId: null, isPartOfTrade: false, isDeleting: false });
  
  // Selection state for combining executions
  const [selectedExecutions, setSelectedExecutions] = useState<Set<number>>(new Set());
  const [isCombineModalOpen, setIsCombineModalOpen] = useState(false);
  const [combining, setCombining] = useState(false);
  const [exporting, setExporting] = useState(false);
  
  // Assign to trade state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [creatingTradeInModal, setCreatingTradeInModal] = useState(false);
  
  // Sorting state
  const [sortConfig, setSortConfig] = useState<{ key: string; order: 'asc' | 'desc' } | null>(null);

  // Save filters whenever they change
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);
  
  useEffect(() => {
    sessionStorage.setItem(`${STORAGE_KEY}_temp`, JSON.stringify(tempFilters));
  }, [tempFilters]);

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

  const fetchExecutions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Normalize matched filter to ensure it's a proper boolean before sending
      // (defensive: sessionStorage may contain stale string values from older code)
      const rawMatched = filters.matched as boolean | string | null | undefined;
      const normalizedMatched =
        rawMatched === undefined || rawMatched === null
          ? undefined
          : rawMatched === true || rawMatched === 'true'
            ? true
            : rawMatched === false || rawMatched === 'false'
              ? false
              : undefined;
      
      const apiFilters: ExecutionsFilter = {
        ...filters,
        matched: normalizedMatched,
        side: filters.side === 'ALL' ? undefined : filters.side,
        asset_class: tempFilters.asset_class === 'ALL' ? undefined : tempFilters.asset_class,
        account_ids: filters.account_ids && filters.account_ids.length > 0 ? filters.account_ids : undefined,
        account_id: undefined,
      };
      const response = await api.getExecutions(apiFilters);
      if (response.success) {
        setExecutions(response.data);
        setTotal(response.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch executions');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchAccounts();
    fetchExecutions();
  }, [fetchAccounts, fetchExecutions]);

  const handleApplyFilters = () => {
    setFilters(prev => ({
      ...prev,
      symbol: tempFilters.symbol || undefined,
      underlying: tempFilters.underlying || undefined,
      start_date: tempFilters.start_date || undefined,
      end_date: tempFilters.end_date || undefined,
      entry_time_start: tempFilters.entry_time_start || undefined,
      entry_time_end: tempFilters.entry_time_end || undefined,
      side: tempFilters.side === 'ALL' ? undefined : tempFilters.side,
      asset_class: tempFilters.asset_class === 'ALL' ? undefined : tempFilters.asset_class,
      account_ids: tempFilters.account_ids && tempFilters.account_ids.length > 0 ? tempFilters.account_ids : undefined,
      matched: tempFilters.matched === 'ALL' ? undefined : tempFilters.matched === 'true',
      offset: 0,
    }));
  };

  const handleClearFilters = () => {
    const cleared = {
      symbol: '',
      underlying: '',
      start_date: '',
      end_date: '',
      entry_time_start: '',
      entry_time_end: '',
      side: 'ALL',
      asset_class: 'ALL',
      account_ids: [] as number[],
      matched: 'ALL',
    };
    setTempFilters(cleared);
    setFilters({
      limit: 50,
      offset: 0,
    });
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

  const handleDeleteClick = (id: number) => {
    const exec = executions.find(e => e.id === id);
    setDeleteModal({ isOpen: true, executionId: id, isPartOfTrade: !!exec?.matched_trade_id, isDeleting: false });
  };

  const handleConfirmDelete = async () => {
    if (deleteModal.executionId) {
      setDeleteModal(prev => ({ ...prev, isDeleting: true }));
      try {
        await api.deleteExecution(deleteModal.executionId);
        fetchExecutions();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete execution');
      } finally {
        setDeleteModal({ isOpen: false, executionId: null, isPartOfTrade: false, isDeleting: false });
      }
    }
  };

  const handleToggleOpenClose = async (exec: Execution) => {
    try {
      const response = await api.toggleExecutionOpen(exec.id);
      if (response.success) {
        setExecutions(prev => prev.map(e => e.id === exec.id ? { ...e, is_open: response.data.is_open } : e));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle open/close');
    }
  };

  const handleEditSuccess = () => {
    setEditingExecution(null);
    fetchExecutions();
  };

  // Selection handlers
  const toggleExecutionSelection = (executionId: number) => {
    setSelectedExecutions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(executionId)) {
        newSet.delete(executionId);
      } else {
        newSet.add(executionId);
      }
      return newSet;
    });
  };

  const selectAllExecutions = () => {
    if (selectedExecutions.size === executions.length) {
      setSelectedExecutions(new Set());
    } else {
      setSelectedExecutions(new Set(executions.map(e => e.id)));
    }
  };

  const clearSelection = () => {
    setSelectedExecutions(new Set());
  };

  // Assign to trade handler
  const handleOpenAssignModal = async () => {
    if (selectedExecutions.size === 0) return;
    setShowAssignModal(true);
    setLoadingTrades(true);
    setSelectedTradeId(null);
    try {
      const response = await api.getTrades({ limit: 100, sort_by: 'id', sort_order: 'desc' });
      if (response.success) {
        setTrades(response.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trades');
    } finally {
      setLoadingTrades(false);
    }
  };

  const handleAssignToTrade = async () => {
    if (!selectedTradeId || selectedExecutions.size === 0) return;
    setAssigning(true);
    setError(null);
    try {
      const response = await api.assignExecutionsToTrade(selectedTradeId, Array.from(selectedExecutions));
      if (response.success) {
        setShowAssignModal(false);
        setSelectedExecutions(new Set());
        setSelectedTradeId(null);
        fetchExecutions();
      } else {
        setError(response.message || 'Failed to assign executions');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign executions');
    } finally {
      setAssigning(false);
    }
  };

  const handleCombineExecutions = async () => {
    if (selectedExecutions.size < 2) return;
    
    setCombining(true);
    try {
      const response = await api.combineExecutions(Array.from(selectedExecutions));
      if (response.success) {
        setSelectedExecutions(new Set());
        setIsCombineModalOpen(false);
        fetchExecutions();
      } else {
        alert(response.error || 'Failed to combine executions');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to combine executions');
    } finally {
      setCombining(false);
    }
  };

  const formatCurrency = (value: number | undefined) => {
    if (value === undefined || value === null) return '-';
    return value >= 0 
      ? `$${value.toFixed(2)}` 
      : `-$${Math.abs(value).toFixed(2)}`;
  };

  const formatDateTime = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    return formatDateTimeUtil(dateStr) || dateStr;
  };

  const totalPages = Math.ceil(total / (filters.limit || 50));
  const currentPage = Math.floor((filters.offset || 0) / (filters.limit || 50)) + 1;

  return (
    <div className="min-h-screen bg-background">
      <SimpleNav title="Executions" />

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
                    <SelectItem value="BUY">Buy</SelectItem>
                    <SelectItem value="SELL">Sell</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Asset Class</label>
                <Select
                  value={tempFilters.asset_class}
                  onValueChange={(value: string) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, asset_class: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Classes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Classes</SelectItem>
                    <SelectItem value="OPT">Options</SelectItem>
                    <SelectItem value="STK">Stocks</SelectItem>
                    <SelectItem value="FUT">Futures</SelectItem>
                    <SelectItem value="FOP">Future Options</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Trade Matched</label>
                <Select
                  value={tempFilters.matched}
                  onValueChange={(value: string) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, matched: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="true">Matched</SelectItem>
                    <SelectItem value="false">Unmatched</SelectItem>
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
                <label className="text-sm font-medium mb-2 block">Time Start</label>
                <Input
                  type="time"
                  value={tempFilters.entry_time_start}
                  onChange={(e) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, entry_time_start: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Time End</label>
                <Input
                  type="time"
                  value={tempFilters.entry_time_end}
                  onChange={(e) => setTempFilters((prev: typeof tempFilters) => ({ ...prev, entry_time_end: e.target.value }))}
                />
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
              Showing {executions.length} of {total} executions
            </p>
            {selectedExecutions.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{selectedExecutions.size} selected</Badge>
                <Button
                  size="sm"
                  onClick={() => setIsCombineModalOpen(true)}
                  disabled={selectedExecutions.size < 2 || combining}
                >
                  <Link2 className="h-4 w-4 mr-2" />
                  Combine into Trade
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenAssignModal}
                  disabled={selectedExecutions.size < 1}
                >
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Assign to Trade
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearSelection}
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setIsAddModalOpen(true)}
              variant="default"
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Execution
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (executions.length === 0) return;
                try {
                  setExporting(true);
                  // Normalize matched filter for export as well
                  const exportRawMatched = filters.matched as boolean | string | null | undefined;
                  const exportMatched =
                    exportRawMatched === undefined || exportRawMatched === null
                      ? undefined
                      : exportRawMatched === true || exportRawMatched === 'true'
                        ? true
                        : exportRawMatched === false || exportRawMatched === 'false'
                          ? false
                          : undefined;
                  
                  const apiFilters: ExecutionsFilter = {
                    ...filters,
                    matched: exportMatched,
                    limit: total || 100000,
                    offset: 0,
                    side: filters.side === 'ALL' ? undefined : filters.side,
                    asset_class: filters.asset_class === 'ALL' ? undefined : filters.asset_class,
                    account_ids: filters.account_ids && filters.account_ids.length > 0 ? filters.account_ids : undefined,
                    account_id: undefined,
                  };
                  const response = await api.getExecutions(apiFilters);
                  if (response.success) {
                    const allExecutions = response.data;
                    const headers = ['ID', 'Date/Time', 'Account', 'Symbol', 'Side', 'Qty', 'Price', 'Commission', 'Net Cash', 'Asset Class'];
                    const rows = allExecutions.map(e => [
                      e.id,
                      e.exec_datetime || e.trade_date,
                      accounts.find(a => a.id === e.account_id)?.name || e.account_id,
                      e.symbol,
                      e.side,
                      e.quantity,
                      e.price,
                      e.commission,
                      e.net_cash,
                      e.asset_class
                    ]);
                    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `executions_${new Date().toISOString().split('T')[0]}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }
                } catch (err) {
                  console.error('Failed to export executions:', err);
                } finally {
                  setExporting(false);
                }
              }}
              disabled={executions.length === 0 || exporting}
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
                      checked={selectedExecutions.size === executions.length && executions.length > 0}
                      onCheckedChange={selectAllExecutions}
                      aria-label="Select all executions"
                    />
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('id')}>
                    <div className="flex items-center gap-1">ID {getSortIcon('id')}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('exec_datetime')}>
                    <div className="flex items-center gap-1">Date/Time {getSortIcon('exec_datetime')}</div>
                  </TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('symbol')}>
                    <div className="flex items-center gap-1">Symbol {getSortIcon('symbol')}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('side')}>
                    <div className="flex items-center gap-1">Side {getSortIcon('side')}</div>
                  </TableHead>
                  <TableHead className="text-center">Open/Close</TableHead>
                  <TableHead className="text-right cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('quantity')}>
                    <div className="flex items-center justify-end gap-1">Qty {getSortIcon('quantity')}</div>
                  </TableHead>
                  <TableHead className="text-right cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('price')}>
                    <div className="flex items-center justify-end gap-1">Price {getSortIcon('price')}</div>
                  </TableHead>
                  <TableHead className="text-right cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('commission')}>
                    <div className="flex items-center justify-end gap-1">Commission {getSortIcon('commission')}</div>
                  </TableHead>
                  <TableHead className="text-right cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('net_cash')}>
                    <div className="flex items-center justify-end gap-1">Net Cash {getSortIcon('net_cash')}</div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleSort('asset_class')}>
                    <div className="flex items-center gap-1">Asset {getSortIcon('asset_class')}</div>
                  </TableHead>
                  <TableHead>Trade</TableHead>
                  <TableHead className="text-right sticky right-0 bg-background z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center py-8">
                      <div className="flex items-center justify-center gap-2">
                        <div className="spinner w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        Loading...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : executions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center py-8 text-muted-foreground">
                      No executions found
                    </TableCell>
                  </TableRow>
                ) : (
                  executions.map((exec) => (
                    <TableRow 
                      key={exec.id}
                      className={`cursor-pointer hover:bg-secondary/50 ${selectedExecutions.has(exec.id) ? 'bg-primary/5' : ''}`}
                      onClick={() => setEditingExecution(exec)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedExecutions.has(exec.id)}
                          onCheckedChange={() => toggleExecutionSelection(exec.id)}
                          aria-label={`Select execution ${exec.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{exec.id}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(exec.exec_datetime || exec.trade_date)}
                      </TableCell>
                      <TableCell>{exec.account_name || exec.account_alias || '-'}</TableCell>
                      <TableCell className="font-medium">{exec.symbol}</TableCell>
                      <TableCell>
                        <Badge variant={exec.side === 'BUY' ? 'default' : 'secondary'}>
                          {exec.side}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-xs text-muted-foreground">{exec.is_open === false ? 'Close' : 'Open'}</span>
                          <Switch
                            checked={exec.is_open !== false}
                            onCheckedChange={() => handleToggleOpenClose(exec)}
                            className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {Math.abs(exec.quantity || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(exec.price)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-loss">
                        {formatCurrency(exec.commission)}
                      </TableCell>
                      <TableCell className={`text-right font-mono ${(exec.net_cash || 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                        {formatCurrency(exec.net_cash)}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {exec.asset_class || '-'}
                        </span>
                      </TableCell>
                      <TableCell>
                        {exec.matched_trade_id ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs font-mono"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/trades/${exec.matched_trade_id}`);
                            }}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            #{exec.matched_trade_id}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right sticky right-0 bg-background z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)]" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {exec.matched_trade_id && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => navigate(`/trades/${exec.matched_trade_id}`)}
                              title="View trade"
                            >
                              <ExternalLink className="h-4 w-4 text-primary" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSplittingExecution(exec)}
                            disabled={Boolean(exec.matched_trade_id) || Math.abs(exec.quantity || 0) < 2}
                            title={
                              exec.matched_trade_id
                                ? 'Unmatch from trade first'
                                : Math.abs(exec.quantity || 0) < 2
                                  ? 'Quantity must be at least 2'
                                  : 'Split execution'
                            }
                            aria-label="Split execution"
                          >
                            <Split className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingExecution(exec)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteClick(exec.id)}
                          >
                            <Trash2 className="h-4 w-4 text-loss" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
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
      </main>

      {editingExecution && (
        <ExecutionEditModal
          execution={editingExecution}
          onClose={() => setEditingExecution(null)}
          onSuccess={handleEditSuccess}
        />
      )}

      {splittingExecution && (
        <ExecutionSplitModal
          execution={splittingExecution}
          onClose={() => setSplittingExecution(null)}
          onSuccess={() => {
            setSplittingExecution(null);
            fetchExecutions();
          }}
        />
      )}

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        title="Delete Execution"
        message={
          deleteModal.isPartOfTrade
            ? 'Are you sure you want to delete this execution? This execution is part of a trade. Deleting it will recalculate trades and stats.'
            : 'Are you sure you want to delete this execution? This execution is not part of a trade. Deleting it will not affect trades or stats.'
        }
        confirmText={deleteModal.isDeleting ? 'Deleting...' : 'Delete'}
        cancelText="Cancel"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteModal({ isOpen: false, executionId: null, isPartOfTrade: false, isDeleting: false })}
        isConfirmDisabled={deleteModal.isDeleting}
      />

      {/* Add Modal */}
      {isAddModalOpen && (
        <ExecutionAddModal
          accounts={accounts}
          defaultAccountId={filters.account_ids?.[0]}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={() => {
            setIsAddModalOpen(false);
            fetchExecutions();
          }}
        />
      )}

      {/* Combine Executions Modal */}
      <ConfirmModal
        isOpen={isCombineModalOpen}
        title="Combine Executions into Trade"
        message={`Are you sure you want to combine ${selectedExecutions.size} executions into a trade? This will calculate P&L and link the executions together.`}
        confirmText={combining ? 'Combining...' : 'Combine'}
        cancelText="Cancel"
        variant="success"
        onConfirm={handleCombineExecutions}
        onCancel={() => setIsCombineModalOpen(false)}
        isConfirmDisabled={combining}
      />

      {/* Assign to Trade Modal */}
      <Dialog open={showAssignModal} onOpenChange={setShowAssignModal}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Assign {selectedExecutions.size} Execution(s) to Trade</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {loadingTrades ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading trades...
              </div>
            ) : trades.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No trades found. Create a trade first.
              </div>
            ) : (
              <div className="space-y-2">
                {trades.map((trade) => (
                  <div
                    key={trade.id}
                    className={`flex items-center gap-3 p-3 border rounded-md cursor-pointer transition-colors ${
                      selectedTradeId === trade.id ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                    }`}
                    onClick={() => setSelectedTradeId(trade.id)}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">#{trade.id}</span>
                        <span className="font-medium">{trade.symbol}</span>
                        <Badge variant={trade.side === 'LONG' ? 'default' : 'secondary'} className="text-xs">
                          {trade.side}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {trade.entry_date ? formatDate(trade.entry_date) : '-'}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {(trade.description || trade.symbol)} • P&L: {trade.net_pnl >= 0 ? '+' : ''}${trade.net_pnl?.toFixed(2) || '0.00'}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-sm text-muted-foreground">{trade.account_name || ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="border-t pt-4 flex items-center justify-between">
            <Button
              variant="outline"
              onClick={async () => {
                if (accounts.length === 0) return;
                setCreatingTradeInModal(true);
                try {
                  const accountId = filters.account_ids?.[0] || accounts[0]?.id;
                  if (!accountId) return;
                  const response = await api.createTrade({ account_id: accountId });
                  if (response.success && response.data) {
                    setTrades(prev => [response.data, ...prev]);
                    setSelectedTradeId(response.data.id);
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to create trade');
                } finally {
                  setCreatingTradeInModal(false);
                }
              }}
              disabled={creatingTradeInModal}
            >
              {creatingTradeInModal ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1" />
                  Create New Trade
                </>
              )}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowAssignModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAssignToTrade}
                disabled={!selectedTradeId || assigning}
              >
              {assigning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Assigning...
                </>
              ) : (
                <>
                  <ArrowRight className="h-4 w-4 mr-1" />
                  Assign to Trade #{selectedTradeId}
                </>
              )}
            </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
