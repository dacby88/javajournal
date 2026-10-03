import { useState } from 'react';
import { api } from '@/services/api';
import type { Execution } from '@/types';
import { 
  X, 
  Plus, 
  AlertCircle,
  DollarSign,
  Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from './DatePicker';

interface ExecutionAddModalProps {
  accounts: Array<{ id: number; name: string }>;
  onClose: () => void;
  onSuccess: () => void;
  defaultAccountId?: number | null;
}

export function ExecutionAddModal({ accounts, onClose, onSuccess, defaultAccountId }: ExecutionAddModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString().slice(0, 16);
  
  // Use defaultAccountId if provided, otherwise fall back to first account
  const getInitialAccountId = () => {
    if (defaultAccountId && accounts.find(a => a.id === defaultAccountId)) {
      return defaultAccountId;
    }
    return accounts.length > 0 ? accounts[0].id : undefined;
  };
  
  const [formData, setFormData] = useState<Partial<Execution>>({
    account_id: getInitialAccountId(),
    symbol: '',
    description: '',
    underlying_symbol: '',
    asset_class: 'OPT',
    side: 'BUY',
    quantity: undefined,
    price: undefined,
    commission: undefined,
    broker_execution_commission: undefined,
    net_cash: undefined,
    amount: undefined,
    proceeds: undefined,
    trade_date: today,
    exec_datetime: now,
    order_time: undefined,
    expiry: undefined,
    strike: undefined,
    put_call: undefined,
    multiplier: 100,
    exchange: '',
    notes: '',
    client_account_id: '',
    account_alias: '',
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
    
    // Get current time portion or default to now
    const currentDateTime = formData.exec_datetime || now;
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
    
    const currentDateTime = formData.exec_datetime || now;
    const datePart = currentDateTime.slice(0, 10);
    
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

  const handleSave = async () => {
    // Validate required fields
    if (!formData.account_id) {
      setError('Please select an account');
      return;
    }
    if (!formData.symbol || formData.symbol.trim() === '') {
      setError('Symbol is required');
      return;
    }
    if (formData.quantity === undefined || formData.quantity === null) {
      setError('Quantity is required');
      return;
    }
    if (formData.price === undefined || formData.price === null) {
      setError('Price is required');
      return;
    }
    if (!formData.trade_date) {
      setError('Trade date is required');
      return;
    }
    
    try {
      setSaving(true);
      setError(null);
      
      const response = await api.createExecution(formData);
      
      if (response.success) {
        setSuccess(true);
        setTimeout(() => {
          onSuccess();
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create execution');
    } finally {
      setSaving(false);
    }
  };

  const formatDateOnlyForInput = (dateStr: string | undefined) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toISOString().slice(0, 10);
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
              <Plus className="h-5 w-5" />
              Add New Execution
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Create a new execution. Trades and stats will be recalculated.
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
            <Alert className="mb-6 bg-green-500/10 text-green-600 border-green-500/20">
              <Check className="h-4 w-4" />
              <AlertDescription>
                Execution created successfully! Trades and stats have been recalculated.
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
                  <Label htmlFor="account">Account *</Label>
                  <Select
                    value={formData.account_id?.toString() || ''}
                    onValueChange={(value) => handleChange('account_id', parseInt(value))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map(acc => (
                        <SelectItem key={acc.id} value={acc.id.toString()}>{acc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="symbol">Symbol *</Label>
                  <Input
                    id="symbol"
                    value={formData.symbol || ''}
                    onChange={(e) => handleChange('symbol', e.target.value.toUpperCase())}
                    placeholder="e.g., SPXW"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="underlying">Underlying Symbol</Label>
                  <Input
                    id="underlying"
                    value={formData.underlying_symbol || ''}
                    onChange={(e) => handleChange('underlying_symbol', e.target.value.toUpperCase())}
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
                  <Select
                    value={formData.asset_class || ''}
                    onValueChange={(value) => handleChange('asset_class', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select asset class" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OPT">Options (OPT)</SelectItem>
                      <SelectItem value="STK">Stocks (STK)</SelectItem>
                      <SelectItem value="FUT">Futures (FUT)</SelectItem>
                      <SelectItem value="FOP">Future Options (FOP)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="side">Side *</Label>
                  <Select
                    value={formData.side || ''}
                    onValueChange={(value) => handleChange('side', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select side" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BUY">Buy</SelectItem>
                      <SelectItem value="SELL">Sell</SelectItem>
                    </SelectContent>
                  </Select>
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
                    date={formData.exec_datetime ? formData.exec_datetime.slice(0, 10) : today}
                    onChange={handleExecDateChange}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exec_time">Execution Time *</Label>
                  <Input
                    id="exec_time"
                    type="time"
                    value={formData.exec_datetime ? formData.exec_datetime.slice(11, 16) : '00:00'}
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
                      placeholder="0.00"
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
                      placeholder="0.00"
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
                  <Select
                    value={formData.put_call || ''}
                    onValueChange={(value) => handleChange('put_call', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="C">Call (C)</SelectItem>
                      <SelectItem value="P">Put (P)</SelectItem>
                    </SelectContent>
                  </Select>
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
                    date={formData.order_time ? formData.order_time.slice(0, 10) : ''}
                    onChange={(dateStr) => {
                      if (!dateStr) {
                        handleChange('order_time', undefined);
                        return;
                      }
                      const timePart = formData.order_time ? formData.order_time.slice(11, 16) : '00:00';
                      handleChange('order_time', `${dateStr}T${timePart}`);
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="order_time_time">Order Time</Label>
                  <Input
                    id="order_time_time"
                    type="time"
                    value={formData.order_time ? formData.order_time.slice(11, 16) : ''}
                    onChange={(e) => {
                      const timeStr = e.target.value;
                      if (!timeStr) return;
                      const datePart = formData.order_time ? formData.order_time.slice(0, 10) : new Date().toISOString().slice(0, 10);
                      handleChange('order_time', `${datePart}T${timeStr}`);
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="client_account_id">Client Account ID</Label>
                  <Input
                    id="client_account_id"
                    value={formData.client_account_id || ''}
                    onChange={(e) => handleChange('client_account_id', e.target.value)}
                    placeholder="e.g., U1234567"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="account_alias">Account Alias</Label>
                  <Input
                    id="account_alias"
                    value={formData.account_alias || ''}
                    onChange={(e) => handleChange('account_alias', e.target.value)}
                    placeholder="Account alias"
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
              * Required fields
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
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Execution
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
