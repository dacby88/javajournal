import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, ArrowRight } from 'lucide-react';
import { api } from '@/services/api';
import type { Execution, Trade } from '@/types';
import { formatDate, formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ManualTradeMatcherProps {
  executions: Execution[];
  accountId: number;
  onDone: () => void;
}

function formatCurrency(value: number | undefined | null): string {
  if (value === undefined || value === null) return '-';
  return value >= 0 ? `$${value.toFixed(2)}` : `-$${Math.abs(value).toFixed(2)}`;
}

function sortExecutions(executions: Execution[]): Execution[] {
  return [...executions].sort((a, b) => {
    const ta = a.exec_datetime || a.trade_date || '';
    const tb = b.exec_datetime || b.trade_date || '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    const symbolCmp = (a.symbol || '').localeCompare(b.symbol || '');
    return symbolCmp || a.id - b.id;
  });
}

function toggleIds(current: Set<number>, ids: number[]): Set<number> {
  const next = new Set(current);
  const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
  if (allSelected) {
    ids.forEach((id) => next.delete(id));
  } else {
    ids.forEach((id) => next.add(id));
  }
  return next;
}

export function ManualTradeMatcher({ executions, accountId, onDone }: ManualTradeMatcherProps) {
  const [unmatched, setUnmatched] = useState<Execution[]>(executions);
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [createdTradeIds, setCreatedTradeIds] = useState<Set<number>>(new Set());
  const [selectedExecIds, setSelectedExecIds] = useState<Set<number>>(new Set());
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(null);
  const [loadingTrades, setLoadingTrades] = useState(true);
  const [busy, setBusy] = useState<'create' | 'assign' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hiddenTradeIds = useRef<Set<number>>(new Set());

  const sortedExecutions = useMemo(() => sortExecutions(unmatched), [unmatched]);
  const allExecIds = useMemo(() => sortedExecutions.map((exec) => exec.id), [sortedExecutions]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingTrades(true);
      try {
        const response = await api.getTrades({
          account_id: accountId,
          trade_status: 'open',
          limit: 1000,
          sort_by: 'entry_date',
          sort_order: 'desc',
        });
        if (!cancelled && response.success) {
          setOpenTrades((prev) => {
            const prevById = new Map(prev.map((trade) => [trade.id, trade]));
            const incoming = response.data.filter((trade) => !hiddenTradeIds.current.has(trade.id));
            const incomingIds = new Set(incoming.map((trade) => trade.id));
            const localOnly = prev.filter((trade) => !incomingIds.has(trade.id));
            return [...localOnly, ...incoming.map((trade) => prevById.get(trade.id) ?? trade)];
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load open trades');
        }
      } finally {
        if (!cancelled) setLoadingTrades(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const upsertOpenTrade = (trade: Trade) => {
    setOpenTrades((prev) => [trade, ...prev.filter((row) => row.id !== trade.id)]);
    setCreatedTradeIds((prev) => new Set(prev).add(trade.id));
    setSelectedTradeId(trade.id);
  };

  const removeMatched = (ids: number[]) => {
    const drop = new Set(ids);
    setUnmatched((prev) => prev.filter((exec) => !drop.has(exec.id)));
    setSelectedExecIds(new Set());
  };

  const handleCreateTrade = async () => {
    const ids = Array.from(selectedExecIds);
    if (ids.length === 0) return;
    setBusy('create');
    setError(null);
    setNotice(null);
    try {
      const response = await api.combineExecutions(ids);
      if (!response.success || !response.data) {
        throw new Error(response.error || response.message || 'Failed to create trade');
      }
      removeMatched(ids);
      if (response.data.is_open) {
        upsertOpenTrade(response.data);
        setNotice(`Created open trade #${response.data.id}. It is selected below so you can add more executions.`);
      } else {
        setNotice(`Created closed trade #${response.data.id}. It is not listed with open trades.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create trade');
    } finally {
      setBusy(null);
    }
  };

  const handleAssign = async () => {
    const ids = Array.from(selectedExecIds);
    if (ids.length === 0 || selectedTradeId == null) return;
    setBusy('assign');
    setError(null);
    setNotice(null);
    try {
      const response = await api.assignExecutionsToTrade(selectedTradeId, ids);
      if (!response.success || !response.data) {
        throw new Error('Failed to assign executions');
      }
      removeMatched(ids);
      if (response.data.is_open) {
        setOpenTrades((prev) => prev.map((trade) => trade.id === response.data.id ? response.data : trade));
        setNotice(`Added ${ids.length} execution(s) to trade #${response.data.id}.`);
      } else {
        hiddenTradeIds.current.add(response.data.id);
        setOpenTrades((prev) => prev.filter((trade) => trade.id !== response.data.id));
        setSelectedTradeId(null);
        setNotice(`Trade #${response.data.id} is now closed and was removed from the open list.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign executions');
    } finally {
      setBusy(null);
    }
  };

  const selectedTrade = openTrades.find((trade) => trade.id === selectedTradeId) || null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error && (
        <div className="shrink-0 rounded border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss">
          {error}
        </div>
      )}
      {notice && (
        <div className="shrink-0 rounded border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          {notice}
        </div>
      )}

      <div className="flex min-h-0 flex-1 basis-0 flex-col rounded border bg-background">
        <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
          <h3 className="text-sm font-medium">Imported executions ({unmatched.length})</h3>
          {selectedExecIds.size > 0 && (
            <span className="text-xs text-muted-foreground">{selectedExecIds.size} selected</span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {sortedExecutions.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              Every imported execution has been matched.
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-10 bg-background">
                    <Checkbox
                      checked={allExecIds.length > 0 && allExecIds.every((id) => selectedExecIds.has(id))}
                      onCheckedChange={() => setSelectedExecIds((prev) => toggleIds(prev, allExecIds))}
                      aria-label="Select all executions"
                    />
                  </TableHead>
                  <TableHead className="bg-background">Date/Time</TableHead>
                  <TableHead className="bg-background">Symbol</TableHead>
                  <TableHead className="bg-background">Side</TableHead>
                  <TableHead className="bg-background text-right">Qty</TableHead>
                  <TableHead className="bg-background text-right">Price</TableHead>
                  <TableHead className="bg-background text-right">Commission</TableHead>
                  <TableHead className="bg-background text-right">Net cash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedExecutions.map((exec) => (
                  <TableRow
                    key={exec.id}
                    className={`cursor-pointer ${selectedExecIds.has(exec.id) ? 'bg-primary/5' : ''}`}
                    onClick={() => setSelectedExecIds((prev) => toggleIds(prev, [exec.id]))}
                  >
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={selectedExecIds.has(exec.id)}
                        onCheckedChange={() => setSelectedExecIds((prev) => toggleIds(prev, [exec.id]))}
                        aria-label={`Select execution ${exec.id}`}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDateTime(exec.exec_datetime || exec.trade_date)}
                    </TableCell>
                    <TableCell className="font-medium">{exec.symbol || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={exec.side === 'BUY' ? 'default' : 'secondary'} className="text-xs">
                        {exec.side}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Math.abs(exec.quantity || 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(exec.price)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(exec.commission)}</TableCell>
                    <TableCell className={`text-right font-mono ${(exec.net_cash || 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {formatCurrency(exec.net_cash)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleCreateTrade} disabled={busy !== null || selectedExecIds.size === 0}>
            {busy === 'create' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
            Create trade{selectedExecIds.size > 0 ? ` (${selectedExecIds.size})` : ''}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAssign}
            disabled={busy !== null || selectedExecIds.size === 0 || selectedTradeId == null}
          >
            {busy === 'assign' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-1 h-4 w-4" />}
            {selectedTrade ? `Assign to #${selectedTrade.id}` : 'Assign to selected trade'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedExecIds(new Set())}
            disabled={selectedExecIds.size === 0 || busy !== null}
          >
            Clear
          </Button>
          <div className="ml-auto">
            <Button size="sm" variant="outline" onClick={onDone} disabled={busy !== null}>
              Done
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 basis-0 flex-col rounded border bg-background">
          <div className="shrink-0 border-b px-3 py-2">
            <h3 className="text-sm font-medium">Open trades ({openTrades.length})</h3>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loadingTrades ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading open trades...
              </div>
            ) : openTrades.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                No open trades yet. Create one from the executions above.
              </div>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-10 bg-background" />
                    <TableHead className="bg-background">ID</TableHead>
                    <TableHead className="bg-background">Description</TableHead>
                    <TableHead className="bg-background">Side</TableHead>
                    <TableHead className="bg-background text-right">Open qty</TableHead>
                    <TableHead className="bg-background">Entry</TableHead>
                    <TableHead className="bg-background text-right">Entry price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openTrades.map((trade) => (
                    <TableRow
                      key={trade.id}
                      className={`cursor-pointer ${selectedTradeId === trade.id ? 'bg-primary/5' : ''}`}
                      onClick={() => setSelectedTradeId(trade.id)}
                    >
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selectedTradeId === trade.id}
                          onCheckedChange={() => setSelectedTradeId(trade.id)}
                          aria-label={`Select trade ${trade.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        #{trade.id}
                        {createdTradeIds.has(trade.id) && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">New</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[28rem] truncate" title={trade.description || trade.symbol}>
                        {trade.description || trade.symbol}
                      </TableCell>
                      <TableCell>
                        <Badge variant={trade.side === 'LONG' ? 'default' : 'secondary'} className="text-xs">
                          {trade.side}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {trade.open_qty != null ? Number(trade.open_qty).toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(trade.entry_date)}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(trade.entry_price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
    </div>
  );
}
