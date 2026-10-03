import { useMemo, useState } from 'react';
import { api } from '@/services/api';
import type { Execution } from '@/types';
import { AlertCircle, Plus, Split, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

interface ExecutionSplitModalProps {
  execution: Execution;
  onClose: () => void;
  onSuccess: () => void;
}

const MONEY_FIELDS = ['commission', 'amount', 'net_cash'] as const;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function allocateProRata(original: number, absQtys: number[]): number[] {
  const total = absQtys.reduce((sum, qty) => sum + qty, 0);
  if (total === 0) return absQtys.map(() => 0);
  const shares = absQtys.map((qty, index) => {
    if (index === absQtys.length - 1) return 0;
    return round4(original * (qty / total));
  });
  const allocated = shares.slice(0, -1).reduce((sum, share) => sum + share, 0);
  shares[shares.length - 1] = round4(original - allocated);
  return shares;
}

function parseAbsQty(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (!Number.isInteger(abs) || abs < 1) return null;
  return abs;
}

function formatCurrency(value: number | undefined | null): string {
  if (value === undefined || value === null) return '-';
  return value >= 0 ? `$${value.toFixed(2)}` : `-$${Math.abs(value).toFixed(2)}`;
}

export function ExecutionSplitModal({ execution, onClose, onSuccess }: ExecutionSplitModalProps) {
  const originalAbs = Math.abs(execution.quantity || 0);
  const [quantities, setQuantities] = useState<string[]>(['', '']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedQtys = quantities.map(parseAbsQty);
  const enteredSum = parsedQtys.reduce<number>((sum, qty) => sum + (qty ?? 0), 0);
  const remaining = originalAbs - enteredSum;
  const allValid = parsedQtys.every((qty) => qty !== null);
  const canConfirm = allValid && parsedQtys.length >= 2 && remaining === 0 && !saving;

  const preview = useMemo(() => {
    if (!allValid || parsedQtys.length < 2) return null;
    const absQtys = parsedQtys as number[];
    return {
      commission: allocateProRata(execution.commission ?? 0, absQtys),
      amount: allocateProRata(execution.amount ?? 0, absQtys),
      netCash: allocateProRata(execution.net_cash ?? 0, absQtys),
    };
  }, [allValid, parsedQtys, execution.commission, execution.amount, execution.net_cash]);

  const remainingClass =
    allValid && remaining === 0
      ? 'text-profit'
      : remaining > 0
        ? 'text-amber-500'
        : 'text-loss';

  const handleQtyChange = (index: number, value: string) => {
    setQuantities((prev) => prev.map((qty, i) => (i === index ? value : qty)));
  };

  const handleAdd = () => {
    setQuantities((prev) => [...prev, '']);
  };

  const handleRemove = (index: number) => {
    setQuantities((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleSplit = async () => {
    if (!canConfirm) return;
    setSaving(true);
    setError(null);
    try {
      await api.splitExecution(execution.id, parsedQtys as number[]);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to split execution');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <CardHeader className="border-b border-border flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <Split className="h-5 w-5" />
              Split Execution #{execution.id}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              <span className="font-medium text-foreground">{execution.symbol}</span>
              <Badge variant={execution.side === 'BUY' ? 'default' : 'secondary'}>
                {execution.side}
              </Badge>
              <span>Qty {originalAbs.toLocaleString()}</span>
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </CardHeader>

        <CardContent className="overflow-y-auto flex-1 p-6 space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            {quantities.map((qty, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                  <Label htmlFor={`split-qty-${index}`}>Split {index + 1} quantity</Label>
                  <Input
                    id={`split-qty-${index}`}
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={qty}
                    onChange={(e) => handleQtyChange(index, e.target.value)}
                    placeholder="Contracts"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemove(index)}
                  disabled={quantities.length <= 2}
                  title={quantities.length <= 2 ? 'At least 2 splits required' : 'Remove split'}
                  aria-label="Remove split"
                >
                  <Trash2 className="h-4 w-4 text-loss" />
                </Button>
              </div>
            ))}
          </div>

          <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-1" />
            Add split
          </Button>

          <p className={`text-sm font-medium ${remainingClass}`}>
            Remaining: {remaining.toLocaleString()}
            {allValid && remaining === 0 ? ' — quantities match original' : remaining > 0 ? ' left to allocate' : ' over original'}
          </p>

          <div className="rounded-md border border-border p-3 space-y-2 text-sm">
            <div className="grid grid-cols-3 gap-2 font-medium text-muted-foreground">
              <span></span>
              <span className="text-right">Original</span>
              <span className="text-right">Split total</span>
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono">
              <span>Qty</span>
              <span className="text-right">{originalAbs.toLocaleString()}</span>
              <span className={`text-right ${allValid && remaining === 0 ? 'text-profit' : remainingClass}`}>
                {enteredSum.toLocaleString()}
              </span>
            </div>
            {MONEY_FIELDS.map((field) => {
              const original = execution[field] ?? 0;
              const splitTotal = allValid && remaining === 0 && preview
                ? (field === 'net_cash' ? preview.netCash : preview[field]).reduce((a, b) => a + b, 0)
                : null;
              return (
                <div key={field} className="grid grid-cols-3 gap-2 font-mono">
                  <span className="capitalize">{field === 'net_cash' ? 'Net cash' : field}</span>
                  <span className="text-right">{formatCurrency(original)}</span>
                  <span className={`text-right ${splitTotal !== null ? 'text-profit' : 'text-muted-foreground'}`}>
                    {splitTotal === null ? '—' : formatCurrency(splitTotal)}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>

        <div className="border-t border-border p-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSplit} disabled={!canConfirm}>
            {saving ? 'Splitting...' : `Split into ${quantities.length}`}
          </Button>
        </div>
      </Card>
    </div>
  );
}
