import { useState } from 'react';
import { api } from '@/services/api';
import type { Execution } from '@/types';
import { 
  X, 
  Save, 
  AlertCircle,
  DollarSign,
  Hash,
  Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DatePicker } from './DatePicker';

interface ExecutionEditModalProps {
  execution: Execution;
  onClose: () => void;
  onSuccess: () => void;
}

function sanitizeSymbol(value: string | undefined | null): string | undefined {
  // Convert 'nan', 'NaN', 'NAN' to undefined to prevent displaying them
  if (!value || value.toLowerCase() === 'nan') return undefined;
  return value;
}

export function ExecutionEditModal({ execution, onClose, onSuccess }: ExecutionEditModalProps) {
  const [formData, setFormData] = useState<Partial<Execution>>({
    symbol: execution.symbol,
    description: execution.description,
    underlying_symbol: sanitizeSymbol(execution.underlying_symbol),
    asset_class: execution.asset_class,
    side: execution.side,
    quantity: execution.quantity,
    price: execution.price,
    commission: execution.commission,
    broker_execution_commission: execution.broker_execution_commission,
    net_cash: execution.net_cash,
    amount: execution.amount,
    proceeds: execution.proceeds,
    trade_date: execution.trade_date,
    exec_datetime: execution.exec_datetime,
    order_time: execution.order_time,
    expiry: execution.expiry,
    strike: execution.strike,
    put_call: execution.put_call,
    multiplier: execution.multiplier,
    exchange: execution.exchange,
    notes: execution.notes,
  });
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleChange = (field: keyof Execution, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Handle date change from DatePicker - updates both exec_datetime date and trade_date
  const handleExecDateChange = (dateStr: string) => {
    if (!dateStr) return;
    
    // Get current time portion or default
    const currentDateTime = formData.exec_datetime || execution.exec_datetime || '';
    const timePart = currentDateTime.length > 10 ? currentDateTime.slice(11, 16) : '00:00';
    
    setFormData(prev => ({
      ...prev,
      exec_datetime: `${dateStr}T${timePart}`,
      trade_date: dateStr,
    }));
  };

  // Handle time change - updates exec_datetime time portion
  const handleExecTimeChange = (timeStr: string) => {
    if (!timeStr) return;
    
    const currentDateTime = formData.exec_datetime || execution.exec_datetime || '';
    const datePart = currentDateTime.slice(0, 10) || new Date().toISOString().slice(0, 10);
    
    setFormData(prev => ({
      ...prev,
      exec_datetime: `${datePart}T${timeStr}`,
    }));
  };

  const handleNumberChange = (field: keyof Execution, value: string) => {
    const num = value === '' ? undefined : parseFloat(value);
    handleChange(field, num);
  };

  // Calculate multiplier based on asset class, symbol, and underlying (mirrors backend logic)
  const calculateMultiplier = (): number | undefined => {
    const { asset_class, symbol, underlying_symbol } = formData;
    
    if (!asset_class) return undefined;
    
    if (asset_class === 'OPT') return 100;
    if (asset_class === 'STK') return 1;
    
    // Clean up underlying: strip leading '/' and month/year code (e.g., /MNQH6 -> MNQ)
    let cleanUnderlying = (underlying_symbol || '').toUpperCase();
    if (cleanUnderlying.startsWith('/')) {
      cleanUnderlying = cleanUnderlying.slice(1);
      cleanUnderlying = cleanUnderlying.replace(/[HMUZ]\d$/, '');
    }
    
    const futMultipliers: Record<string, number> = {
      ES: 50,
      MES: 5,
      NQ: 20,
      MNQ: 2,
    };
    
    if (asset_class === 'FUT' || asset_class === 'FOP' || asset_class === 'Future') {
      return futMultipliers[cleanUnderlying] ?? 1;
    }
    
    // For other asset classes, check futures options symbols starting with "./"
    const sym = (symbol || '').toUpperCase();
    if (sym.startsWith('./')) {
      const afterSlash = sym.slice(2);
      for (const [code, mult] of Object.entries(futMultipliers)) {
        if (afterSlash.startsWith(code)) return mult;
      }
    }
    
    // Fallback: check if underlying or symbol contains futures codes
    for (const [code, mult] of Object.entries(futMultipliers)) {
      if (cleanUnderlying.includes(code) || sym.includes(code)) {
        return mult;
      }
    }
    
    return 100; // Default for equity options
  };

  const handleMultiplierFocus = () => {
    const calculated = calculateMultiplier();
    if (calculated !== undefined) {
      handleChange('multiplier', calculated);
    }
  };

  // Calculate amount based on price, quantity, and multiplier
  // Amount = price * quantity * multiplier (signed based on side)
  const calculateAmount = (): number | undefined => {
    const { price, quantity, multiplier, side } = formData;
    
    if (price === undefined || quantity === undefined || !multiplier) {
      return undefined;
    }
    
    const baseAmount = price * quantity * multiplier;
    // For SELL: positive, for BUY: negative
    return side === 'SELL' ? Math.abs(baseAmount) : -Math.abs(baseAmount);
  };

  // Calculate proceeds/net_cash = amount - abs(commissions + fees)
  const calculateProceeds = (): number | undefined => {
    const amount = calculateAmount();
    if (amount === undefined) return undefined;
    
    // Get all commission values (use absolute values)
    const commission = Math.abs(formData.commission ?? 0);
    const brokerExec = Math.abs(formData.broker_execution_commission ?? 0);
    
    // Calculate total commissions
    const totalCommissions = commission + brokerExec;
    
    // Formula: amount - abs(commissions)
    // For SELL: +amount - commissions = less money received
    // For BUY: -amount - commissions = more money paid (more negative)
    return amount - totalCommissions;
  };

  // Handle focus on amount field - always auto-calculate
  const handleAmountFocus = () => {
    const calculated = calculateAmount();
    if (calculated !== undefined) {
      handleChange('amount', calculated);
    }
  };

  // Handle focus on proceeds field - always auto-calculate
  const handleProceedsFocus = () => {
    const calculated = calculateProceeds();
    if (calculated !== undefined) {
      handleChange('proceeds', calculated);
    }
  };

  // Handle focus on net_cash field - always auto-calculate (same as proceeds)
  const handleNetCashFocus = () => {
    const calculated = calculateProceeds();
    if (calculated !== undefined) {
      handleChange('net_cash', calculated);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      
      const response = await api.updateExecution(execution.id, formData);
      
      if (response.success) {
        setSuccess(true);
        setTimeout(() => {
          onSuccess();
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update execution');
    } finally {
      setSaving(false);
    }
  };

  const formatDateOnlyForInput = (dateStr: string | undefined) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toISOString().slice(0, 10); // YYYY-MM-DD
    } catch {
      return '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <CardHeader className="border-b border-border flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <Hash className="h-5 w-5" />
              Edit Execution #{execution.id}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Modify execution details. Changes will recalculate trades and stats.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </CardHeader>

        <CardContent className="overflow-y-auto flex-1 p-6">
          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="mb-6 bg-profit/10 text-profit border-profit/20">
              <Check className="h-4 w-4" />
              <AlertDescription>
                Execution updated successfully! Trades and stats have been recalculated.
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="pricing">Pricing</TabsTrigger>
              <TabsTrigger value="commissions">Commissions</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>

            {/* Basic Info Tab */}
            <TabsContent value="basic" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="symbol">Symbol *</Label>
                  <Input
                    id="symbol"
                    value={formData.symbol || ''}
                    onChange={(e) => handleChange('symbol', e.target.value)}
                    placeholder="e.g., SPXW"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="underlying">Underlying Symbol</Label>
                  <Input
                    id="underlying"
                    value={formData.underlying_symbol || ''}
                    onChange={(e) => handleChange('underlying_symbol', e.target.value)}
                    placeholder="e.g., SPX"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={formData.description || ''}
                    onChange={(e) => handleChange('description', e.target.value)}
                    placeholder="Option description"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="asset_class">Asset Class</Label>
                  <select
                    id="asset_class"
                    value={formData.asset_class || ''}
                    onChange={(e) => handleChange('asset_class', e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background"
                  >
                    <option value="">Select...</option>
                    <option value="OPT">Options (OPT)</option>
                    <option value="STK">Stocks (STK)</option>
                    <option value="FUT">Futures (FUT)</option>
                    <option value="FOP">Future Options (FOP)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="side">Side *</Label>
                  <select
                    id="side"
                    value={formData.side || ''}
                    onChange={(e) => handleChange('side', e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background"
                  >
                    <option value="BUY">Buy</option>
                    <option value="SELL">Sell</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantity *</Label>
                  <Input
                    id="quantity"
                    type="number"
                    step="0.01"
                    value={formData.quantity ?? ''}
                    onChange={(e) => handleNumberChange('quantity', e.target.value)}
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Execution Date *</Label>
                  <DatePicker
                    label=""
                    date={formData.exec_datetime ? formData.exec_datetime.slice(0, 10) : formatDateOnlyForInput(execution.exec_datetime)}
                    onChange={handleExecDateChange}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exec_time">Execution Time *</Label>
                  <Input
                    id="exec_time"
                    type="time"
                    value={formData.exec_datetime ? formData.exec_datetime.slice(11, 16) : (execution.exec_datetime ? execution.exec_datetime.slice(11, 16) : '00:00')}
                    onChange={(e) => handleExecTimeChange(e.target.value)}
                  />
                </div>
              </div>
            </TabsContent>

            {/* Pricing Tab */}
            <TabsContent value="pricing" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="price">Price *</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      className="pl-9"
                      value={formData.price ?? ''}
                      onChange={(e) => handleNumberChange('price', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amount">Amount</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="amount"
                      type="number"
                      step="0.01"
                      className="pl-9"
                      value={formData.amount ?? ''}
                      onChange={(e) => handleNumberChange('amount', e.target.value)}
                      onFocus={handleAmountFocus}
                      placeholder="Click to auto-calculate"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="proceeds">Proceeds</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="proceeds"
                      type="number"
                      step="0.01"
                      className="pl-9"
                      value={formData.proceeds ?? ''}
                      onChange={(e) => handleNumberChange('proceeds', e.target.value)}
                      onFocus={handleProceedsFocus}
                      placeholder="Click to auto-calculate"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="net_cash">Net Cash</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="net_cash"
                      type="number"
                      step="0.01"
                      className="pl-9"
                      value={formData.net_cash ?? ''}
                      onChange={(e) => handleNumberChange('net_cash', e.target.value)}
                      onFocus={handleNetCashFocus}
                      placeholder="Click to auto-calculate"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="strike">Strike Price</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="strike"
                      type="number"
                      step="0.01"
                      className="pl-9"
                      value={formData.strike ?? ''}
                      onChange={(e) => handleNumberChange('strike', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="multiplier">Multiplier</Label>
                  <Input
                    id="multiplier"
                    type="number"
                    value={formData.multiplier ?? ''}
                    onChange={(e) => handleNumberChange('multiplier', e.target.value)}
                    onFocus={handleMultiplierFocus}
                    placeholder="Click to auto-populate"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expiry">Expiration Date</Label>
                  <Input
                    id="expiry"
                    type="date"
                    value={formatDateOnlyForInput(formData.expiry)}
                    onChange={(e) => handleChange('expiry', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="put_call">Put/Call</Label>
                  <select
                    id="put_call"
                    value={formData.put_call || ''}
                    onChange={(e) => handleChange('put_call', e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background"
                  >
                    <option value="">Select...</option>
                    <option value="C">Call (C)</option>
                    <option value="P">Put (P)</option>
                  </select>
                </div>
              </div>
            </TabsContent>

            {/* Commissions Tab */}
            <TabsContent value="commissions" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="commission">Total Commission</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="commission"
                      type="number"
                      step="0.01"
                      className="pl-9"
                      value={formData.commission ?? ''}
                      onChange={(e) => handleNumberChange('commission', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="broker_execution">Broker Execution Commission</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="broker_execution"
                      type="number"
                      step="0.01"
                      className="pl-9"
                      value={formData.broker_execution_commission ?? ''}
                      onChange={(e) => handleNumberChange('broker_execution_commission', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="commission_currency">Commission Currency</Label>
                  <Input
                    id="commission_currency"
                    value={formData.commission_currency || ''}
                    onChange={(e) => handleChange('commission_currency', e.target.value)}
                    placeholder="USD"
                  />
                </div>
              </div>
            </TabsContent>

            {/* Details Tab */}
            <TabsContent value="details" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="exchange">Exchange</Label>
                  <Input
                    id="exchange"
                    value={formData.exchange || ''}
                    onChange={(e) => handleChange('exchange', e.target.value)}
                    placeholder="e.g., CBOE"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Order Date</Label>
                  <DatePicker
                    label=""
                    date={formData.order_time ? formData.order_time.slice(0, 10) : formatDateOnlyForInput(execution.order_time)}
                    onChange={(dateStr) => {
                      if (!dateStr) {
                        handleChange('order_time', undefined);
                        return;
                      }
                      const currentTime = formData.order_time || execution.order_time || '';
                      const timePart = currentTime.length > 10 ? currentTime.slice(11, 16) : '00:00';
                      handleChange('order_time', `${dateStr}T${timePart}`);
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="order_time_time">Order Time</Label>
                  <Input
                    id="order_time_time"
                    type="time"
                    value={formData.order_time ? formData.order_time.slice(11, 16) : (execution.order_time ? execution.order_time.slice(11, 16) : '')}
                    onChange={(e) => {
                      const timeStr = e.target.value;
                      if (!timeStr) return;
                      const currentDateTime = formData.order_time || execution.order_time || '';
                      const datePart = currentDateTime.slice(0, 10) || new Date().toISOString().slice(0, 10);
                      handleChange('order_time', `${datePart}T${timeStr}`);
                    }}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="notes">Notes</Label>
                  <textarea
                    id="notes"
                    rows={4}
                    value={formData.notes || ''}
                    onChange={(e) => handleChange('notes', e.target.value)}
                    placeholder="Additional notes about this execution..."
                    className="w-full px-3 py-2 rounded-md border border-input bg-background resize-none"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>

        {/* Footer */}
        <div className="border-t border-border p-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            <Badge variant="outline" className="mr-2">
              ID: {execution.id}
            </Badge>
            {execution.matched_trade_id && (
              <Badge variant="outline" className="mr-2">
                Trade: #{execution.matched_trade_id}
              </Badge>
            )}
            <Badge variant="outline">
              Account: {execution.account_name || execution.account_alias || execution.account_id}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <div className="spinner w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
