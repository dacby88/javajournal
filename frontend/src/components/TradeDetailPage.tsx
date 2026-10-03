import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import type { Trade, Execution } from '@/types';
import { formatDate as formatDateUtil, formatDateTime as formatDateTimeUtil } from '@/lib/utils';
import { 
  ArrowLeft,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Edit2, 
  Trash2, 
  Hash,
  ArrowRight,
  AlertCircle,
  Link2,
  Link2Off,
  Undo2,
  Unlink,
  BookOpen,
  Save,
  Loader2,
  Plus,
  CheckSquare,
  Square,
  X,
  FileText,
  RefreshCw,
  ExternalLink,
  Scale,
  Layers,
  Clock,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ExecutionEditModal } from './ExecutionEditModal';
import { SimpleNav } from './SimpleNav';
import { TagSelector } from './TagSelector';
import { ConfirmModal } from './ConfirmModal';
import { RichTextEditor } from './RichTextEditor';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function TradeDetailPage() {
  const { tradeId } = useParams<{ tradeId: string }>();
  const navigate = useNavigate();
  const [trade, setTrade] = useState<Trade | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingExecution, setEditingExecution] = useState<Execution | null>(null);
  const [combineHistory, setCombineHistory] = useState<{ is_combined: boolean; can_uncombine: boolean; original_trade_count?: number } | null>(null);
  const [uncombineLoading, setUncombineLoading] = useState(false);
  const [unmatchLoading, setUnmatchLoading] = useState(false);
  const [showUnmatchConfirm, setShowUnmatchConfirm] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [tradeJournalContent, setTradeJournalContent] = useState('');
  const [savingJournal, setSavingJournal] = useState(false);
  const [updatingSide, setUpdatingSide] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [showExecPicker, setShowExecPicker] = useState(false);
  const [unmatchedExecs, setUnmatchedExecs] = useState<Execution[]>([]);
  const [selectedExecIds, setSelectedExecIds] = useState<Set<number>>(new Set());
  const [loadingExecs, setLoadingExecs] = useState(false);
  const [assigningExecs, setAssigningExecs] = useState(false);
  const [showRecalcModal, setShowRecalcModal] = useState(false);
  const [recalcWithStats, setRecalcWithStats] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [recalcConflicts, setRecalcConflicts] = useState<Array<{
    execution_id: number;
    symbol: string;
    current_trade_id: number;
  }>>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingTrade, setDeletingTrade] = useState(false);
  const [showRemoveExecConfirm, setShowRemoveExecConfirm] = useState(false);
  const [removeExecTargets, setRemoveExecTargets] = useState<number[]>([]);
  const [removingExecution, setRemovingExecution] = useState(false);
  const [selectedLinkedExecIds, setSelectedLinkedExecIds] = useState<Set<number>>(new Set());
  const [execSort, setExecSort] = useState<{ key: string; order: 'asc' | 'desc' } | null>(null);
  const [pickerSort, setPickerSort] = useState<{ key: string; order: 'asc' | 'desc' } | null>(null);

  // Per-symbol open/closed status within this trade: sum signed quantities
  // (BUY +, SELL -) per symbol. Non-zero net => symbol still open (no matched
  // close execution yet); zero => symbol has been closed out.
  const symbolStatus = useMemo(() => {
    const netQty = new Map<string, number>();
    executions.forEach((exec) => {
      const symbol = exec.symbol || '-';
      const signed = (exec.side === 'BUY' ? 1 : -1) * Math.abs(exec.quantity || 0);
      netQty.set(symbol, (netQty.get(symbol) || 0) + signed);
    });
    const status = new Map<string, boolean>();
    netQty.forEach((qty, symbol) => status.set(symbol, qty !== 0));
    return status;
  }, [executions]);

  // Open trades have no realized net P&L and no total_commissions on the
  // trade record, so derive net cash and commissions from the executions.
  const isTradeOpen = trade?.is_open === true;
  const netCashSum = useMemo(
    () => executions.reduce((sum, e) => sum + (e.net_cash || 0), 0),
    [executions]
  );
  const execCommissionsSum = useMemo(
    () => executions.reduce((sum, e) => sum + (e.commission || 0), 0),
    [executions]
  );

  // Remaining open lots per symbol: net qty across all fills, avg price and
  // net cash from executions still marked open.
  const openPositions = useMemo(() => {
    const bySymbol = new Map<string, {
      description: string | null;
      signedQty: number;
      openQtyAbs: number;
      openCost: number;
      openNetCash: number;
    }>();

    executions.forEach((exec) => {
      const symbol = exec.symbol || '-';
      const absQty = Math.abs(exec.quantity || 0);
      const signed = (exec.side === 'BUY' ? 1 : -1) * absQty;
      const row = bySymbol.get(symbol) ?? {
        description: null,
        signedQty: 0,
        openQtyAbs: 0,
        openCost: 0,
        openNetCash: 0,
      };
      row.signedQty += signed;
      if (!row.description && exec.description) {
        row.description = exec.description;
      }
      if (exec.is_open !== false) {
        row.openQtyAbs += absQty;
        row.openCost += absQty * (exec.price || 0);
        row.openNetCash += exec.net_cash || 0;
      }
      bySymbol.set(symbol, row);
    });

    return Array.from(bySymbol.entries())
      .filter(([, row]) => Math.abs(row.signedQty) > 1e-8)
      .map(([symbol, row]) => ({
        symbol,
        description: row.description,
        side: row.signedQty > 0 ? 'BUY' : 'SELL',
        qty: Math.abs(row.signedQty),
        avgPrice: row.openQtyAbs > 0 ? row.openCost / row.openQtyAbs : 0,
        netCash: row.openNetCash,
        mid: null as number | null,
        openPnl: null as number | null,
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [executions]);

  // Fully closed lots per symbol (net qty back to zero). Qty/avg price come
  // from the entry executions; net cash across all executions is the
  // realized P&L for that security.
  const closedPositions = useMemo(() => {
    const bySymbol = new Map<string, {
      description: string | null;
      signedQty: number;
      openQtyAbs: number;
      openCost: number;
      openSignedQty: number;
      netCash: number;
    }>();

    executions.forEach((exec) => {
      const symbol = exec.symbol || '-';
      const absQty = Math.abs(exec.quantity || 0);
      const signed = (exec.side === 'BUY' ? 1 : -1) * absQty;
      const row = bySymbol.get(symbol) ?? {
        description: null,
        signedQty: 0,
        openQtyAbs: 0,
        openCost: 0,
        openSignedQty: 0,
        netCash: 0,
      };
      row.signedQty += signed;
      row.netCash += exec.net_cash || 0;
      if (!row.description && exec.description) {
        row.description = exec.description;
      }
      if (exec.is_open !== false) {
        row.openQtyAbs += absQty;
        row.openCost += absQty * (exec.price || 0);
        row.openSignedQty += signed;
      }
      bySymbol.set(symbol, row);
    });

    return Array.from(bySymbol.entries())
      .filter(([, row]) => Math.abs(row.signedQty) <= 1e-8)
      .map(([symbol, row]) => ({
        symbol,
        description: row.description,
        side: row.openSignedQty >= 0 ? 'BUY' : 'SELL',
        qty: row.openQtyAbs,
        avgPrice: row.openQtyAbs > 0 ? row.openCost / row.openQtyAbs : 0,
        netCash: row.netCash,
        pnl: row.netCash,
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [executions]);

  const displayPnl = isTradeOpen
    ? (trade?.open_pnl != null ? trade.open_pnl : null)
    : (trade?.net_pnl || 0);

  const markedOpenPositions = useMemo(() => {
    if (trade?.open_positions && trade.open_positions.length > 0) {
      return trade.open_positions.map((pos) => ({
        symbol: pos.symbol,
        description: pos.description ?? null,
        side: pos.side,
        qty: pos.qty,
        avgPrice: pos.avg_price,
        netCash: pos.net_cash,
        mid: pos.mid,
        openPnl: pos.open_pnl ?? null,
      }));
    }
    return openPositions;
  }, [trade?.open_positions, openPositions]);

  // Qty totals are gross contract counts (calls and puts summed together).
  // Open P&L total is null when no position has a quote, matching the rows.
  const openPositionsTotals = useMemo(() => {
    const pnlValues = markedOpenPositions
      .map((p) => p.openPnl)
      .filter((v): v is number => v != null);
    return {
      qty: markedOpenPositions.reduce((sum, p) => sum + p.qty, 0),
      netCash: markedOpenPositions.reduce((sum, p) => sum + p.netCash, 0),
      openPnl: pnlValues.length > 0 ? pnlValues.reduce((sum, v) => sum + v, 0) : null,
    };
  }, [markedOpenPositions]);

  const closedPositionsTotals = useMemo(() => ({
    qty: closedPositions.reduce((sum, p) => sum + p.qty, 0),
    netCash: closedPositions.reduce((sum, p) => sum + p.netCash, 0),
    pnl: closedPositions.reduce((sum, p) => sum + p.pnl, 0),
  }), [closedPositions]);

  const handleExecSort = (key: string) => {
    setExecSort((prev) =>
      prev?.key === key && prev.order === 'asc'
        ? { key, order: 'desc' }
        : { key, order: 'asc' }
    );
  };

  const getExecSortIcon = (key: string) => {
    if (execSort?.key !== key) return <ArrowUpDown className="h-3 w-3 text-muted-foreground" />;
    return execSort.order === 'asc'
      ? <ArrowUp className="h-3 w-3 text-primary" />
      : <ArrowDown className="h-3 w-3 text-primary" />;
  };

  const sortedExecutions = useMemo(() => {
    if (!execSort) return executions;
    const getValue = (exec: Execution): string | number => {
      switch (execSort.key) {
        case 'id': return exec.id;
        case 'datetime': return exec.exec_datetime || exec.trade_date || '';
        case 'symbol': return exec.symbol || '';
        case 'status': return symbolStatus.get(exec.symbol || '-') ? 1 : 0;
        case 'side': return exec.side || '';
        case 'open_close': return exec.is_open === false ? 1 : 0;
        case 'quantity': return Math.abs(exec.quantity || 0);
        case 'price': return exec.price || 0;
        case 'commission': return exec.commission || 0;
        case 'net_cash': return exec.net_cash || 0;
        default: return exec.id;
      }
    };
    return [...executions].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
      return execSort.order === 'asc' ? cmp : -cmp;
    });
  }, [executions, execSort, symbolStatus]);

  const handlePickerSort = (key: string) => {
    setPickerSort((prev) =>
      prev?.key === key && prev.order === 'asc'
        ? { key, order: 'desc' }
        : { key, order: 'asc' }
    );
  };

  const getPickerSortIcon = (key: string) => {
    if (pickerSort?.key !== key) return <ArrowUpDown className="h-3 w-3 text-muted-foreground" />;
    return pickerSort.order === 'asc'
      ? <ArrowUp className="h-3 w-3 text-primary" />
      : <ArrowDown className="h-3 w-3 text-primary" />;
  };

  const sortedUnmatchedExecs = useMemo(() => {
    if (!pickerSort) return unmatchedExecs;
    const getValue = (exec: Execution): string | number => {
      switch (pickerSort.key) {
        case 'datetime': return exec.exec_datetime || exec.trade_date || '';
        case 'symbol': return exec.symbol || '';
        case 'side': return exec.side || '';
        case 'quantity': return Math.abs(exec.quantity || 0);
        case 'price': return exec.price || 0;
        case 'commission': return exec.commission || 0;
        default: return exec.id;
      }
    };
    return [...unmatchedExecs].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
      return pickerSort.order === 'asc' ? cmp : -cmp;
    });
  }, [unmatchedExecs, pickerSort]);

  const fetchTradeData = useCallback(async () => {
    if (!tradeId) return;
    
    try {
      setLoading(true);
      setError(null);
      
      // Fetch trade details
      const tradeResponse = await api.getTrade(parseInt(tradeId));
      if (tradeResponse.success) {
        setTrade(tradeResponse.data);
        setTradeJournalContent(tradeResponse.data.notes || '');
      }
      
      // Fetch executions for this trade
      const execsResponse = await api.getTradeExecutions(parseInt(tradeId));
      if (execsResponse.success) {
        setExecutions(execsResponse.data);
        const liveIds = new Set(execsResponse.data.map((exec) => exec.id));
        setSelectedLinkedExecIds((prev) => {
          const next = new Set([...prev].filter((id) => liveIds.has(id)));
          return next.size === prev.size ? prev : next;
        });
      }
      
      // Fetch combine history
      const historyResponse = await api.getTradeCombineHistory(parseInt(tradeId));
      if (historyResponse.success) {
        setCombineHistory(historyResponse.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch trade data');
    } finally {
      setLoading(false);
    }
  }, [tradeId]);

  useEffect(() => {
    fetchTradeData();
  }, [fetchTradeData]);

  const handleEditSuccess = () => {
    setEditingExecution(null);
    fetchTradeData();
  };

  const toggleLinkedExecSelection = (execId: number) => {
    setSelectedLinkedExecIds((prev) => {
      const next = new Set(prev);
      if (next.has(execId)) next.delete(execId);
      else next.add(execId);
      return next;
    });
  };

  const toggleSelectAllLinkedExecs = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedLinkedExecIds(new Set(sortedExecutions.map((exec) => exec.id)));
    } else {
      setSelectedLinkedExecIds(new Set());
    }
  };

  const unlinkWouldEmptyTrade = selectedLinkedExecIds.size > 0
    && selectedLinkedExecIds.size >= executions.length;

  const handleRemoveExecutions = async () => {
    if (removeExecTargets.length === 0 || !tradeId) return;

    setRemovingExecution(true);
    try {
      const response = removeExecTargets.length === 1
        ? await api.unassignExecution(removeExecTargets[0])
        : await api.unassignExecutions(parseInt(tradeId), removeExecTargets);
      if (!response.success) {
        throw new Error(response.error || 'Failed to remove execution from trade');
      }
      if (response.warning) {
        setError(response.warning);
      }
      const removedIds = removeExecTargets;
      setShowRemoveExecConfirm(false);
      setRemoveExecTargets([]);
      setSelectedLinkedExecIds((prev) => {
        const next = new Set(prev);
        removedIds.forEach((id) => next.delete(id));
        return next;
      });
      fetchTradeData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove execution from trade');
    } finally {
      setRemovingExecution(false);
    }
  };

  const handleToggleOpenClose = async (exec: Execution) => {
    try {
      const response = await api.toggleExecutionOpen(exec.id);
      if (response.success) {
        fetchTradeData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle open/close');
    }
  };

  // Handle tag updates
  const handleUpdateTags = async (tags: import('@/types').TradeTag[]) => {
    if (!tradeId) return;
    
    try {
      const response = await api.setTradeTags(parseInt(tradeId), tags.map(t => t.id));
      if (response.success) {
        setTrade(prev => prev ? { ...prev, tags: response.data } : null);
        setEditingTags(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tags');
    }
  };

  const handleUncombineTrade = async () => {
    if (!tradeId) return;
    
    setUncombineLoading(true);
    setError(null);
    
    try {
      const response = await api.uncombineTrade(parseInt(tradeId));
      if (response.success) {
        // Navigate back to trades page after successful uncombine
        navigate('/trades');
      } else {
        setError(response.message || 'Failed to uncombine trade');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to uncombine trade');
    } finally {
      setUncombineLoading(false);
    }
  };

  const handleUnmatchTrade = async () => {
    if (!tradeId) return;
    
    setUnmatchLoading(true);
    setError(null);
    
    try {
      const response = await api.unmatchTrade(parseInt(tradeId));
      if (response.success) {
        // Navigate back to trades page after successful unmatch
        navigate('/trades');
      } else {
        setError(response.message || 'Failed to unmatch trade');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unmatch trade');
    } finally {
      setUnmatchLoading(false);
      setShowUnmatchConfirm(false);
    }
  };

  const handleSaveTradeJournal = async () => {
    if (!tradeId) return;
    
    setSavingJournal(true);
    setError(null);
    
    try {
      const response = await api.updateTrade(parseInt(tradeId), {
        notes: tradeJournalContent,
      });
      if (response.success) {
        setTrade(prev => prev ? { ...prev, notes: response.data.notes } : null);
      } else {
        setError(response.message || 'Failed to save trade journal');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save trade journal');
    } finally {
      setSavingJournal(false);
    }
  };

  const handleToggleSide = async () => {
    if (!tradeId || !trade) return;
    
    const newSide = trade.side === 'LONG' ? 'SHORT' : 'LONG';
    
    setUpdatingSide(true);
    setError(null);
    
    try {
      const response = await api.updateTrade(parseInt(tradeId), {
        side: newSide,
      });
      if (response.success) {
        setTrade(prev => prev ? { ...prev, side: newSide } : null);
      } else {
        setError(response.message || 'Failed to update side');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update side');
    } finally {
      setUpdatingSide(false);
    }
  };

  // Description editing handlers
  const handleStartEditDescription = () => {
    setDescriptionValue(trade?.description || '');
    setEditingDescription(true);
  };

  const handleSaveDescription = async () => {
    if (!tradeId) return;
    setSavingDescription(true);
    setError(null);
    try {
      const previous = trade?.description || '';
      const descriptionChanged = descriptionValue !== previous;
      const payload: Partial<Trade> = {
        description: descriptionValue,
      };
      if (descriptionChanged) {
        payload.override_auto_description = true;
      }
      const response = await api.updateTrade(parseInt(tradeId), payload);
      if (response.success) {
        setTrade(prev => prev
          ? {
              ...prev,
              description: response.data.description,
              override_auto_description: response.data.override_auto_description,
            }
          : null
        );
        setEditingDescription(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save description');
    } finally {
      setSavingDescription(false);
    }
  };

  const handleToggleOverride = async (checked: boolean) => {
    if (!tradeId) return;
    setSavingOverride(true);
    setError(null);
    try {
      const response = await api.updateTrade(parseInt(tradeId), {
        override_auto_description: checked,
      });
      if (response.success) {
        setTrade(prev => prev
          ? { ...prev, override_auto_description: response.data.override_auto_description }
          : null
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update description override');
    } finally {
      setSavingOverride(false);
    }
  };

  // Execution picker handlers
  const handleOpenExecPicker = async () => {
    setShowExecPicker(true);
    setLoadingExecs(true);
    try {
      const response = await api.getUnmatchedExecutions(trade?.account_id);
      if (response.success) {
        setUnmatchedExecs(response.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load unmatched executions');
    } finally {
      setLoadingExecs(false);
    }
  };

  const handleToggleExecSelection = (execId: number) => {
    setSelectedExecIds(prev => {
      const next = new Set(prev);
      if (next.has(execId)) next.delete(execId);
      else next.add(execId);
      return next;
    });
  };

  const handleAssignExecutions = async () => {
    if (!tradeId || selectedExecIds.size === 0) return;
    setAssigningExecs(true);
    setError(null);
    try {
      const response = await api.assignExecutionsToTrade(parseInt(tradeId), Array.from(selectedExecIds));
      if (response.success) {
        setShowExecPicker(false);
        setSelectedExecIds(new Set());
        fetchTradeData();
      } else {
        setError(response.message || 'Failed to assign executions');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign executions');
    } finally {
      setAssigningExecs(false);
    }
  };

  const handleDeleteTrade = async () => {
    if (!tradeId) return;
    
    setDeletingTrade(true);
    setError(null);
    
    try {
      const response = await api.deleteTrade(parseInt(tradeId));
      if (response.success) {
        navigate('/trades');
      } else {
        setError(response.message || 'Failed to delete trade');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete trade');
    } finally {
      setDeletingTrade(false);
      setShowDeleteConfirm(false);
    }
  };

  // Format multi-symbol display
  const formatMultiSymbol = (symbol: string | undefined) => {
    if (!symbol) return '-';
    const symbols = symbol.split(',').map(s => s.trim());
    if (symbols.length <= 2) return symbol;
    return (
      <span title={symbol}>
        {symbols[0]}, {symbols[1]} <span className="text-muted-foreground">+{symbols.length - 2} more</span>
      </span>
    );
  };

  const formatCurrency = (value: number | undefined) => {
    if (value === undefined || value === null) return '-';
    return value >= 0 
      ? `$${value.toFixed(2)}` 
      : `-$${Math.abs(value).toFixed(2)}`;
  };

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    return formatDateUtil(dateStr) || dateStr;
  };

  const formatDateTime = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    return formatDateTimeUtil(dateStr) || dateStr;
  };

  const calculateDuration = () => {
    if (!trade?.entry_time || !trade?.exit_time) return '-';
    try {
      const entry = new Date(trade.entry_time);
      const exit = new Date(trade.exit_time);
      const diffMs = exit.getTime() - entry.getTime();
      const diffMins = Math.round(diffMs / 60000);

      if (diffMins < 60) return `${diffMins}m`;
      if (diffMins < 1440) {
        const hours = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        return `${hours}h ${mins}m`;
      }
      const days = diffMs / 86400000;
      if (days < 7) {
        const d = Math.floor(days);
        const h = Math.floor((days - d) * 24);
        const m = Math.round(((days - d) * 24 - h) * 60);
        return `${d}d ${h}h ${m}m`;
      }
      if (days < 30) {
        const w = Math.floor(days / 7);
        const d = Math.round(days - w * 7);
        return d > 0 ? `${w}w ${d}d` : `${w}w`;
      }
      return `${Math.round(days / 30)}mo`;
    } catch {
      return '-';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="spinner w-10 h-10 border-3 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading trade details...</p>
        </div>
      </div>
    );
  }

  if (!trade && !loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8 text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Trade Not Found</h2>
          <p className="text-muted-foreground mb-4">The trade you're looking for doesn't exist.</p>
          <Button onClick={() => navigate('/trades')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Trades
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SimpleNav 
        title={
          <div className="flex flex-wrap items-center gap-2">
            <span>Trade #{trade?.id || ''}</span>
            {trade?.account_name && (
              <Badge variant="outline">{trade.account_name}</Badge>
            )}
            {combineHistory?.is_combined && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <Link2 className="h-3 w-3" />
                Combined
              </Badge>
            )}
          </div>
        } 
        showBack={false}
      />

      <main className="container mx-auto px-4 py-6">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Trade Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                Net P&L
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-2xl font-bold ${(displayPnl || 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                    {displayPnl == null ? '-' : formatCurrency(displayPnl)}
                  </div>
                  {isTradeOpen && (
                    <div className={`text-sm ${netCashSum >= 0 ? 'text-profit' : 'text-loss'}`}>
                      Net Cash: {formatCurrency(netCashSum)}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowRecalcModal(true)}
                  title="Recalculate P&L"
                >
                  <RefreshCw className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ArrowRight className="h-4 w-4" />
                Gross P&L
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className={`text-2xl font-bold ${(trade?.gross_pnl || 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                {formatCurrency(trade?.gross_pnl)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Hash className="h-4 w-4" />
                Commissions
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl font-bold text-loss">
                {formatCurrency(isTradeOpen ? execCommissionsSum : trade?.total_commissions)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Duration
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl font-bold">
                {calculateDuration()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Trade Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-col gap-2">
                {combineHistory?.is_combined && combineHistory.can_uncombine && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUncombineTrade}
                    disabled={uncombineLoading}
                    className="w-full"
                  >
                    <Undo2 className="h-4 w-4 mr-2" />
                    {uncombineLoading ? 'Restoring...' : 'Uncombine'}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowUnmatchConfirm(true)}
                  disabled={unmatchLoading}
                  className="w-full"
                >
                  <Unlink className="h-4 w-4 mr-2" />
                  Unmatch Trade
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deletingTrade}
                  className="w-full"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Trade
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Open Quantity + Description Row */}
        <div className="grid grid-cols-5 gap-6 mb-6">
          {/* Open Quantity Card */}
          <Card className="col-span-1">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Scale className="h-5 w-5" />
                Open Quantity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">
                  {trade?.open_qty != null && !isNaN(trade.open_qty)
                    ? Number(trade.open_qty).toFixed(0)
                    : '-'}
                </div>
                {/* Side toggle */}
                <div
                  className="cursor-pointer hover:bg-accent/50 transition-colors rounded-md p-2 border shrink-0"
                  onClick={handleToggleSide}
                  title="Click to toggle between LONG and SHORT"
                >
                  <Badge
                    variant={trade?.side === 'LONG' ? 'default' : 'secondary'}
                    className="text-base px-3 py-1"
                  >
                    {updatingSide && (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    )}
                    {trade?.side || '-'}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Description Card */}
          <Card className="col-span-4">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Description
                </CardTitle>
                <Label
                  className="flex items-center gap-2 text-sm font-normal cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    checked={!!trade?.override_auto_description}
                    onCheckedChange={(checked) => handleToggleOverride(checked === true)}
                    disabled={savingOverride || !trade}
                    aria-label="Override auto description"
                  />
                  Override auto description
                </Label>
              </div>
            </CardHeader>
            <CardContent>
              {editingDescription ? (
                <div className="flex items-start gap-2">
                  <Textarea
                    value={descriptionValue}
                    onChange={(e) => setDescriptionValue(e.target.value)}
                    placeholder="Enter trade description..."
                    rows={3}
                    className="flex-1"
                  />
                  <Button size="sm" onClick={handleSaveDescription} disabled={savingDescription}>
                    {savingDescription ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingDescription(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div
                  className="cursor-pointer hover:bg-accent/50 transition-colors rounded-md p-3 border"
                  onClick={handleStartEditDescription}
                >
                  <p className="font-medium whitespace-pre-wrap break-words">{trade?.description || trade?.symbol || '-'}</p>
                  <p className="text-sm text-muted-foreground mt-1">Click to edit description</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {isTradeOpen && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Open Positions ({markedOpenPositions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {markedOpenPositions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No open positions remaining
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Security Description</TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Avg Price</TableHead>
                        <TableHead className="text-right">Mid</TableHead>
                        <TableHead className="text-right">Net Cash</TableHead>
                        <TableHead className="text-right">Open P&L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {markedOpenPositions.map((pos) => (
                        <TableRow key={pos.symbol}>
                          <TableCell className="text-muted-foreground">{pos.description || '-'}</TableCell>
                          <TableCell className="font-medium">{pos.symbol}</TableCell>
                          <TableCell>
                            <Badge variant={pos.side === 'BUY' ? 'default' : 'secondary'}>
                              {pos.side}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {pos.qty.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(pos.avgPrice)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {pos.mid != null ? formatCurrency(pos.mid) : '-'}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${pos.netCash >= 0 ? 'text-profit' : 'text-loss'}`}>
                            {formatCurrency(pos.netCash)}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${pos.openPnl == null ? '' : pos.openPnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                            {pos.openPnl != null ? formatCurrency(pos.openPnl) : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell></TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {openPositionsTotals.qty.toLocaleString()}
                        </TableCell>
                        <TableCell></TableCell>
                        <TableCell></TableCell>
                        <TableCell className={`text-right font-mono font-semibold ${openPositionsTotals.netCash >= 0 ? 'text-profit' : 'text-loss'}`}>
                          {formatCurrency(openPositionsTotals.netCash)}
                        </TableCell>
                        <TableCell className={`text-right font-mono font-semibold ${openPositionsTotals.openPnl == null ? '' : openPositionsTotals.openPnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                          {openPositionsTotals.openPnl != null ? formatCurrency(openPositionsTotals.openPnl) : '-'}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Closed Positions */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Closed Positions ({closedPositions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {closedPositions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No closed positions in this trade
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Security Description</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Avg Price</TableHead>
                      <TableHead className="text-right">Net Cash</TableHead>
                      <TableHead className="text-right">Realized P&L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closedPositions.map((pos) => (
                      <TableRow key={pos.symbol}>
                        <TableCell className="text-muted-foreground">{pos.description || '-'}</TableCell>
                        <TableCell className="font-medium">{pos.symbol}</TableCell>
                        <TableCell>
                          <Badge variant={pos.side === 'BUY' ? 'default' : 'secondary'}>
                            {pos.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {pos.qty.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(pos.avgPrice)}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${pos.netCash >= 0 ? 'text-profit' : 'text-loss'}`}>
                          {formatCurrency(pos.netCash)}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${pos.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                          {formatCurrency(pos.pnl)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {closedPositionsTotals.qty.toLocaleString()}
                      </TableCell>
                      <TableCell></TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${closedPositionsTotals.netCash >= 0 ? 'text-profit' : 'text-loss'}`}>
                        {formatCurrency(closedPositionsTotals.netCash)}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${closedPositionsTotals.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                        {formatCurrency(closedPositionsTotals.pnl)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Trade Details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Entry Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ArrowRight className="h-5 w-5 text-profit" />
                Entry Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Entry Date</div>
                  <div className="font-medium">{formatDate(trade?.entry_date)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Entry Time</div>
                  <div className="font-medium">{formatDateTime(trade?.entry_time)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Entry Price</div>
                  <div className="font-medium">{formatCurrency(trade?.entry_price)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Quantity</div>
                  <div className="font-medium">{trade?.quantity?.toLocaleString()}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Exit Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ArrowRight className="h-5 w-5 text-loss" />
                Exit Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Exit Date</div>
                  <div className="font-medium">{formatDate(trade?.exit_date)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Exit Time</div>
                  <div className="font-medium">{formatDateTime(trade?.exit_time)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Exit Price</div>
                  <div className="font-medium">{formatCurrency(trade?.exit_price)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Symbol</div>
                  <div className="font-medium">{formatMultiSymbol(trade?.symbol)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Symbols Details */}
        {trade?.symbol && trade.symbol.includes(',') && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">Symbols</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {trade.symbol.split(',').map((sym, idx) => (
                  <Badge key={idx} variant="outline" className="text-sm px-3 py-1">
                    {sym.trim()}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Trade Journal */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Trade Journal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Tags */}
            <div>
              <div className="text-sm text-muted-foreground mb-2">Tags</div>
              {editingTags ? (
                <div className="mt-1">
                  <TagSelector
                    selectedTags={trade?.tags || []}
                    onChange={(tags) => handleUpdateTags(tags)}
                  />
                </div>
              ) : (
                <div 
                  className="flex flex-wrap gap-1 cursor-pointer hover:border-primary/50 transition-colors p-2 border rounded-md"
                  onClick={() => setEditingTags(true)}
                >
                  {trade?.tags && trade.tags.length > 0 ? (
                    trade.tags.map((tag) => (
                      <Badge 
                        key={tag.id} 
                        style={{ backgroundColor: tag.color }}
                        className="text-white text-xs"
                      >
                        {tag.name}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">Click to add tags</span>
                  )}
                </div>
              )}
            </div>

            {/* Rich Text Editor */}
            <RichTextEditor
              value={tradeJournalContent}
              onChange={setTradeJournalContent}
              placeholder="Write your trade journal entry here..."
              className="min-h-[300px]"
            />

            {/* Save Button */}
            <div className="flex justify-end">
              <Button 
                onClick={handleSaveTradeJournal} 
                disabled={savingJournal}
                className="flex items-center gap-2"
              >
                {savingJournal ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save Journal
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Executions Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Hash className="h-5 w-5" />
                Related Executions ({executions.length})
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {selectedLinkedExecIds.size > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    title={unlinkWouldEmptyTrade
                      ? (executions.length <= 1
                        ? 'Cannot remove the only execution. Use Unmatch Trade instead.'
                        : 'Cannot remove every execution. Use Unmatch Trade instead.')
                      : 'Remove selected executions from this trade'}
                    disabled={removingExecution || unlinkWouldEmptyTrade}
                    onClick={() => {
                      setRemoveExecTargets(Array.from(selectedLinkedExecIds));
                      setShowRemoveExecConfirm(true);
                    }}
                  >
                    <Link2Off className="h-4 w-4 mr-1 text-amber-500" />
                    {selectedLinkedExecIds.size === 1
                      ? 'Unlink Execution'
                      : `Unlink ${selectedLinkedExecIds.size} Executions`}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleOpenExecPicker}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Executions
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {executions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No executions found for this trade
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedLinkedExecIds.size === sortedExecutions.length && sortedExecutions.length > 0}
                          onCheckedChange={toggleSelectAllLinkedExecs}
                          aria-label="Select all executions"
                        />
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleExecSort('id')}>
                        <div className="flex items-center gap-1">ID {getExecSortIcon('id')}</div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleExecSort('datetime')}>
                        <div className="flex items-center gap-1">Date/Time {getExecSortIcon('datetime')}</div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleExecSort('symbol')}>
                        <div className="flex items-center gap-1">Symbol {getExecSortIcon('symbol')}</div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-secondary/50 text-center" onClick={() => handleExecSort('status')} title="Whether the symbol is still open or closed">
                        <div className="flex items-center justify-center gap-1">Status {getExecSortIcon('status')}</div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handleExecSort('side')}>
                        <div className="flex items-center gap-1">Side {getExecSortIcon('side')}</div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-secondary/50 text-center" onClick={() => handleExecSort('open_close')}>
                        <div className="flex items-center justify-center gap-1">Open/Close {getExecSortIcon('open_close')}</div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-secondary/50 text-right" onClick={() => handleExecSort('quantity')}>
                        <div className="flex items-center justify-end gap-1">Qty {getExecSortIcon('quantity')}</div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-secondary/50 text-right" onClick={() => handleExecSort('price')}>
                        <div className="flex items-center justify-end gap-1">Price {getExecSortIcon('price')}</div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-secondary/50 text-right" onClick={() => handleExecSort('commission')}>
                        <div className="flex items-center justify-end gap-1">Commission {getExecSortIcon('commission')}</div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-secondary/50 text-right" onClick={() => handleExecSort('net_cash')}>
                        <div className="flex items-center justify-end gap-1">Net Cash {getExecSortIcon('net_cash')}</div>
                      </TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedExecutions.map((exec) => (
                      <TableRow key={exec.id} className={selectedLinkedExecIds.has(exec.id) ? 'bg-primary/5' : ''}>
                        <TableCell>
                          <Checkbox
                            checked={selectedLinkedExecIds.has(exec.id)}
                            onCheckedChange={() => toggleLinkedExecSelection(exec.id)}
                            aria-label={`Select execution ${exec.id}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{exec.id}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDateTime(exec.exec_datetime || exec.trade_date)}
                        </TableCell>
                        <TableCell className="font-medium">{exec.symbol || '-'}</TableCell>
                        <TableCell className="text-center">
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full ${symbolStatus.get(exec.symbol || '-') ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            title={symbolStatus.get(exec.symbol || '-')
                              ? 'Symbol still open — waiting for a closing execution'
                              : 'Symbol closed — has a matched close execution'}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant={exec.side === 'BUY' ? 'default' : 'secondary'}>
                            {exec.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
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
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
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
                              title={executions.length === 1
                                ? 'Cannot remove the only execution. Use Unmatch Trade instead.'
                                : 'Remove execution from this trade'}
                              aria-label="Remove execution from trade"
                              disabled={executions.length === 1}
                              onClick={() => {
                                setRemoveExecTargets([exec.id]);
                                setShowRemoveExecConfirm(true);
                              }}
                            >
                              <Link2Off className="h-4 w-4 text-amber-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Edit Modal */}
      {editingExecution && (
        <ExecutionEditModal
          execution={editingExecution}
          onClose={() => setEditingExecution(null)}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* Unmatch Trade Confirmation Modal */}
      <ConfirmModal
        isOpen={showUnmatchConfirm}
        onCancel={() => setShowUnmatchConfirm(false)}
        onConfirm={handleUnmatchTrade}
        title="Unmatch Trade"
        message="Are you sure you want to unmatch this trade? This will delete the trade and unlink all executions. The executions will be available for re-processing into new trades."
        confirmText={unmatchLoading ? 'Unmatching...' : 'Unmatch'}
        variant="danger"
      />

      {/* Delete Trade Confirmation Modal */}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteTrade}
        title="Delete Trade"
        message="Are you sure you want to delete this trade? The trade will be permanently removed. All linked executions will be preserved and available for re-processing into new trades."
        confirmText={deletingTrade ? 'Deleting...' : 'Delete Trade'}
        variant="danger"
      />

      {/* Remove Execution from Trade Confirmation Modal */}
      <ConfirmModal
        isOpen={showRemoveExecConfirm}
        onCancel={() => {
          setShowRemoveExecConfirm(false);
          setRemoveExecTargets([]);
        }}
        onConfirm={handleRemoveExecutions}
        title={removeExecTargets.length > 1 ? 'Remove Executions from Trade' : 'Remove Execution from Trade'}
        message={removeExecTargets.length > 1
          ? `This will remove ${removeExecTargets.length} executions from this trade without deleting them. The trade will be automatically recalculated from its remaining executions, and the removed executions will become unmatched so they can be assigned to a different trade.`
          : 'This will remove the execution from this trade without deleting it. The trade will be automatically recalculated from its remaining executions, and the removed execution will become unmatched so it can be assigned to a different trade.'}
        confirmText={removingExecution
          ? (removeExecTargets.length > 1 ? 'Removing executions...' : 'Removing execution...')
          : (removeExecTargets.length > 1 ? `Remove ${removeExecTargets.length} from Trade` : 'Remove from Trade')}
        isConfirmDisabled={removingExecution}
        variant="warning"
      />

      {/* Recalculate P&L Modal */}
      <Dialog open={showRecalcModal} onOpenChange={setShowRecalcModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Recalculate P&L
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This will recalculate the P&L for trade #{tradeId} from its linked executions using the net cash methodology.
            </p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={recalcWithStats}
                onChange={(e) => setRecalcWithStats(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm font-medium">
                Also recalculate account stats
              </span>
            </label>
            <p className="text-xs text-muted-foreground">
              {recalcWithStats
                ? `Daily stats will be recalculated for ${trade?.account_name || "this trade's account"}.`
                : "This trade's P&L will be updated. Daily stats for this account stay unchanged until you recalculate them."}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowRecalcModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!tradeId) return;
                setRecalculating(true);
                setError(null);
                try {
                  const response = await api.recalculateSingleTradePnL(parseInt(tradeId), recalcWithStats);
                  if (response.success) {
                    setShowRecalcModal(false);
                    fetchTradeData();
                  } else if (response.needs_confirmation && response.conflicts) {
                    setRecalcConflicts(response.conflicts);
                    setShowConflictModal(true);
                  } else {
                    setError(response.error || 'Failed to recalculate P&L');
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to recalculate P&L');
                } finally {
                  setRecalculating(false);
                }
              }}
              disabled={recalculating}
            >
              {recalculating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Recalculating...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Recalculate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conflict Confirmation Modal */}
      <Dialog open={showConflictModal} onOpenChange={setShowConflictModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Execution Linkage Conflicts
            </DialogTitle>
            <DialogDescription>
              Some executions in this trade are linked to other trades. Do you want to reassign them to this trade?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2 max-h-60 overflow-auto">
            {recalcConflicts.map((c) => (
              <div key={c.execution_id} className="flex items-center justify-between p-2 border rounded-md bg-secondary/30">
                <div>
                  <span className="font-mono text-sm">#{c.execution_id}</span>
                  <span className="text-sm ml-2">{c.symbol || 'Unknown'}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => navigate(`/trades/${c.current_trade_id}`)}
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Trade #{c.current_trade_id}
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowConflictModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!tradeId) return;
                setRecalculating(true);
                setError(null);
                try {
                  const response = await api.recalculateSingleTradePnL(
                    parseInt(tradeId),
                    recalcWithStats,
                    true // force_reassign
                  );
                  if (response.success) {
                    setShowConflictModal(false);
                    setShowRecalcModal(false);
                    fetchTradeData();
                  } else {
                    setError(response.error || 'Failed to recalculate P&L');
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to recalculate P&L');
                } finally {
                  setRecalculating(false);
                }
              }}
              disabled={recalculating}
            >
              {recalculating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Reassigning...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reassign & Recalculate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Execution Picker Modal */}
      <Dialog open={showExecPicker} onOpenChange={setShowExecPicker}>
        <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-[95vw] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Add Executions to Trade #{tradeId}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {loadingExecs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                Loading unmatched executions...
              </div>
            ) : unmatchedExecs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No unmatched executions available for this account.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handlePickerSort('datetime')}>
                      <div className="flex items-center gap-1">Date/Time {getPickerSortIcon('datetime')}</div>
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handlePickerSort('symbol')}>
                      <div className="flex items-center gap-1">Symbol {getPickerSortIcon('symbol')}</div>
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-secondary/50" onClick={() => handlePickerSort('side')}>
                      <div className="flex items-center gap-1">Side {getPickerSortIcon('side')}</div>
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-secondary/50 text-right" onClick={() => handlePickerSort('quantity')}>
                      <div className="flex items-center justify-end gap-1">Qty {getPickerSortIcon('quantity')}</div>
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-secondary/50 text-right" onClick={() => handlePickerSort('price')}>
                      <div className="flex items-center justify-end gap-1">Price {getPickerSortIcon('price')}</div>
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-secondary/50 text-right" onClick={() => handlePickerSort('commission')}>
                      <div className="flex items-center justify-end gap-1">Commission {getPickerSortIcon('commission')}</div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedUnmatchedExecs.map((exec) => (
                    <TableRow
                      key={exec.id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => handleToggleExecSelection(exec.id)}
                    >
                      <TableCell>
                        {selectedExecIds.has(exec.id) ? (
                          <CheckSquare className="h-4 w-4 text-primary" />
                        ) : (
                          <Square className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateTime(exec.exec_datetime || exec.trade_date)}
                      </TableCell>
                      <TableCell className="font-medium">{exec.symbol}</TableCell>
                      <TableCell>
                        <Badge variant={exec.side === 'BUY' ? 'default' : 'secondary'} className="text-xs">
                          {exec.side}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {Math.abs(exec.quantity || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(exec.price)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(exec.commission)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter className="flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">
              {selectedExecIds.size} execution(s) selected
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowExecPicker(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAssignExecutions}
                disabled={selectedExecIds.size === 0 || assigningExecs}
              >
                {assigningExecs ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    Assigning...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-1" />
                    Assign {selectedExecIds.size} Execution(s)
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
