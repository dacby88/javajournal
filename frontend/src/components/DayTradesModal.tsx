import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import type { DailyStats, Trade, DailyJournal, EventTag } from '@/types';
import { formatDate, formatDateTime, formatTime } from '@/lib/utils';
import { 
  X, 
  TrendingUp, 
  TrendingDown, 
  DollarSign,
  Calendar,
  BarChart3,
  BookOpen,
  Save,
  Loader2,
  Eye,
  ExternalLink,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RichTextEditor } from './RichTextEditor';
import { TagSelector, TagDisplay } from './TagSelector';
import type { TradeTag } from '@/types';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface DayTradesModalProps {
  date: string;
  dailyStats: DailyStats | null;
  selectedAccounts: number[];
  onClose: () => void;
}

export function DayTradesModal({ date, dailyStats, selectedAccounts, onClose }: DayTradesModalProps) {
  const navigate = useNavigate();
  // A new trade always belongs to exactly one account
  const primaryAccount = selectedAccounts[0] ?? null;
  const [trades, setTrades] = useState<Trade[]>([]);
  const [journal, setJournal] = useState<DailyJournal | null>(null);
  const [journalContent, setJournalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [journalLoading, setJournalLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [editingTradeId, setEditingTradeId] = useState<number | null>(null);
  const [tradeTags, setTradeTags] = useState<TradeTag[]>([]);
  const [updatingTags, setUpdatingTags] = useState(false);
  const tagEditorRef = useRef<HTMLTableCellElement>(null);
  
  // Event tags state for daily journal
  const [eventTags, setEventTags] = useState<EventTag[]>([]);
  
  // Exclude margin checkbox state (default checked)
  const [excludeMargin, setExcludeMargin] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch trades for the selected date and accounts
        const tradesResponse = await api.getTrades({
          start_date: date,
          end_date: date,
          account_ids: selectedAccounts,
          limit: 100,
          offset: 0,
        });
        
        if (tradesResponse.success) {
          setTrades(tradesResponse.data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch trades');
      } finally {
        setLoading(false);
      }
    };

    const fetchJournal = async () => {
      try {
        setJournalLoading(true);
        const response = await api.getJournal(date);
        if (response.success && response.data) {
          setJournal(response.data);
          setJournalContent(response.data.content);
          setEventTags(response.data.event_tags || []);
        } else {
          setJournal(null);
          setJournalContent('');
          setEventTags([]);
        }
      } catch (err) {
        console.error('Failed to fetch journal:', err);
      } finally {
        setJournalLoading(false);
      }
    };

    fetchData();
    fetchJournal();
  }, [date, selectedAccounts]);

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

  const handleSaveJournal = async () => {
    try {
      setSaving(true);
      setSaveSuccess(false);
      
      // Strip HTML tags for plain text version
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = journalContent;
      const plainText = tempDiv.textContent || tempDiv.innerText || '';
      
      const response = await api.saveJournal({
        date,
        content: journalContent,
        content_text: plainText,
        event_tag_ids: eventTags.map(t => t.id),
      });
      
      if (response.success) {
        setJournal(response.data);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save journal');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTradeTags = async (tradeId: number, tags: TradeTag[]) => {
    try {
      setUpdatingTags(true);
      const response = await api.setTradeTags(tradeId, tags.map(t => t.id));
      if (response.success) {
        // Update the trade in the local state
        setTrades(prev => prev.map(trade => 
          trade.id === tradeId ? { ...trade, tags: response.data } : trade
        ));
        // Update tradeTags to reflect the saved state
        setTradeTags(response.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tags');
    } finally {
      setUpdatingTags(false);
    }
    // Don't close the editor - let user continue editing or click elsewhere
  };

  const formatCurrency = (value: number | undefined) => {
    if (value === undefined || value === null) return '-';
    return value >= 0 
      ? `$${value.toFixed(2)}` 
      : `-$${Math.abs(value).toFixed(2)}`;
  };

  const formatDateLabel = (dateStr: string) => {
    return formatDate(dateStr) || dateStr;
  };

  // Format multi-symbol display
  const formatMultiSymbol = (symbol: string | undefined) => {
    if (!symbol) return '-';
    const symbols = symbol.split(',').map(s => s.trim());
    if (symbols.length <= 2) return symbol;
    return (
      <span title={symbol}>
        {symbols[0]}, {symbols[1]} <span className="text-muted-foreground">+{symbols.length - 2}</span>
      </span>
    );
  };

  const handleViewTrade = (tradeId: number) => {
    navigate(`/trades/${tradeId}`);
    onClose(); // Close the modal after navigation
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <Card className="w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <CardHeader className="border-b border-border flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              {formatDateLabel(date)}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Daily trading journal, summary and trades
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </CardHeader>

        <CardContent className="overflow-y-auto flex-1 p-6">
          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {saveSuccess && (
            <Alert className="mb-6 bg-green-500/10 text-green-600 border-green-500/20">
              <AlertDescription>Journal saved successfully!</AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="journal" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="journal" className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                Journal
              </TabsTrigger>
              <TabsTrigger value="summary" className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Summary
              </TabsTrigger>
              <TabsTrigger value="trades" className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Trades
                {trades.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {trades.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Journal Tab */}
            <TabsContent value="journal" className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Daily Journal</h3>
                  <p className="text-sm text-muted-foreground">
                    Record your thoughts, analysis, and lessons learned
                  </p>
                </div>
                <Button 
                  onClick={handleSaveJournal} 
                  disabled={saving}
                  className="flex items-center gap-2"
                >
                  {saving ? (
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

              {/* Eco Data/News Box */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">Eco Data/News</Label>
                </div>
                <TagSelector
                  selectedTags={eventTags}
                  onChange={setEventTags}
                  tagType="event"
                  placeholder="Click to add event tags (e.g., FOMC, NFP, Earnings)..."
                />
              </div>

              {journalLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  Loading journal...
                </div>
              ) : (
                <div key={date} className="space-y-4">
                  <RichTextEditor
                    value={journalContent}
                    onChange={setJournalContent}
                    placeholder="Write your daily journal entry here..."
                    className="min-h-[400px]"
                  />
                </div>
              )}

              {journal?.updated_at && (
                <p className="text-xs text-muted-foreground">
                  Last saved: {formatDateTime(journal.updated_at)}
                </p>
              )}
            </TabsContent>

            {/* Summary Tab */}
            <TabsContent value="summary" className="space-y-6">
              {/* Daily Summary Cards */}
              {dailyStats ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card className="bg-secondary/50">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          {dailyStats.net_pnl >= 0 ? (
                            <TrendingUp className="h-4 w-4 text-profit" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-loss" />
                          )}
                          <span className="text-sm text-muted-foreground">Net P&L</span>
                        </div>
                        <div className={`text-2xl font-bold ${dailyStats.net_pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                          {formatCurrency(dailyStats.net_pnl)}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-secondary/50">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <BarChart3 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Total Trades</span>
                        </div>
                        <div className="text-2xl font-bold">
                          {dailyStats.total_trades}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-secondary/50 relative">
                      <CardContent className="p-4">
                        <div className="absolute top-2 right-2 flex items-center gap-2">
                          <Checkbox
                            id="exclude-margin"
                            checked={excludeMargin}
                            onCheckedChange={(checked) => setExcludeMargin(checked === true)}
                            className="h-3.5 w-3.5"
                          />
                          <Label htmlFor="exclude-margin" className="text-xs text-muted-foreground cursor-pointer">
                            Exclude Margin
                          </Label>
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex gap-1">
                            <TrendingUp className="h-4 w-4 text-profit" />
                            <span className="text-sm text-muted-foreground">Win/Loss</span>
                          </div>
                        </div>
                        <div className="text-2xl font-bold">
                          <span className="text-profit">{dailyStats.winning_trades}</span>
                          <span className="text-muted-foreground mx-1">/</span>
                          <span className="text-loss">{dailyStats.losing_trades}</span>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="bg-secondary/50">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <DollarSign className="h-4 w-4 text-loss" />
                          <span className="text-sm text-muted-foreground">Commission</span>
                        </div>
                        <div className="text-2xl font-bold text-loss">
                          {formatCurrency(dailyStats.total_commission)}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Additional Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Gross P&L:</span>
                      <span className={`ml-2 font-medium ${dailyStats.gross_pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                        {formatCurrency(dailyStats.gross_pnl)}
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Win Rate:</span>
                      <span className="ml-2 font-medium">
                        {dailyStats.total_trades > 0 
                          ? ((dailyStats.winning_trades / dailyStats.total_trades) * 100).toFixed(1) 
                          : 0}%
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Break Even:</span>
                      <span className="ml-2 font-medium">
                        {dailyStats.break_even_trades}
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Largest Profit:</span>
                      <span className="ml-2 font-medium text-profit">
                        {formatCurrency(dailyStats.largest_profit)}
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Largest Loss:</span>
                      <span className="ml-2 font-medium text-loss">
                        {formatCurrency(dailyStats.largest_loss)}
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Avg Trade P&L:</span>
                      <span className={`ml-2 font-medium ${dailyStats.avg_trade_pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                        {formatCurrency(dailyStats.avg_trade_pnl)}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No trading data for this day
                </div>
              )}
            </TabsContent>

            {/* Trades Tab */}
            <TabsContent value="trades">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  Trades
                  <Badge variant="outline" className="text-sm">
                    {trades.length}
                  </Badge>
                </h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={async () => {
                      if (!primaryAccount) {
                        setError('Please select an account first');
                        return;
                      }
                      try {
                        const response = await api.createTrade({ 
                          account_id: primaryAccount,
                          entry_date: date,
                          exit_date: date,
                        });
                        if (response.success && response.data) {
                          // Refresh the trades list to show the new trade
                          const tradesResponse = await api.getTrades({
                            start_date: date,
                            end_date: date,
                            account_ids: selectedAccounts,
                            limit: 100,
                            offset: 0,
                          });
                          if (tradesResponse.success) {
                            setTrades(tradesResponse.data);
                          }
                          // Open the new trade in a new tab
                          window.open(`/trades/${response.data.id}`, '_blank');
                        } else {
                          setError(response.message || 'Failed to create trade');
                        }
                      } catch (err) {
                        console.error('Failed to create trade:', err);
                        setError(err instanceof Error ? err.message : 'Failed to create trade');
                      }
                    }}
                    title={
                      selectedAccounts.length > 1
                        ? 'A new trade must belong to one account - it will be created in the first selected account'
                        : undefined
                    }
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    New Trade Here
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const params = new URLSearchParams();
                      params.set('start_date', date);
                      params.set('end_date', date);
                      params.set('date_filter_mode', 'active_date');
                      if (selectedAccounts.length === 1) {
                        params.set('account_id', selectedAccounts[0].toString());
                      } else if (selectedAccounts.length > 1) {
                        params.set('account_ids', selectedAccounts.join(','));
                      }
                      window.open(`/trades?${params.toString()}`, '_blank');
                    }}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View in Trades Page
                  </Button>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading trades...
                </div>
              ) : trades.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No trades for this day
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Entry</TableHead>
                        <TableHead className="text-right">Exit</TableHead>
                        <TableHead className="text-right">P&L</TableHead>
                        <TableHead>Entry Time</TableHead>
                        <TableHead>Exit Time</TableHead>
                        <TableHead>Tags</TableHead>
                        <TableHead className="text-center">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trades.map((trade) => (
                        <TableRow key={trade.id} className="hover:bg-secondary/50 cursor-pointer" onClick={() => handleViewTrade(trade.id)}>
                          <TableCell className="font-medium">{trade.description || formatMultiSymbol(trade.symbol)}</TableCell>
                          <TableCell>
                            <Badge variant={trade.side === 'LONG' ? 'default' : 'secondary'}>
                              {trade.side}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {trade.quantity}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {trade.entry_price != null ? `$${trade.entry_price.toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {trade.exit_price != null ? `$${trade.exit_price.toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${trade.net_pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                            {formatCurrency(trade.net_pnl)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {trade.entry_time ? formatTime(trade.entry_time) : '-'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {trade.exit_time ? formatTime(trade.exit_time) : '-'}
                          </TableCell>
                          <TableCell
                            ref={editingTradeId === trade.id ? tagEditorRef : null}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {editingTradeId === trade.id ? (
                              <div className="min-w-[200px]">
                                <TagSelector
                                  selectedTags={tradeTags}
                                  onChange={(tags) => handleUpdateTradeTags(trade.id, tags)}
                                  disabled={updatingTags}
                                />
                              </div>
                            ) : (
                              <div
                                className="cursor-pointer hover:bg-secondary/50 p-1 rounded"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingTradeId(trade.id);
                                  setTradeTags(trade.tags || []);
                                }}
                              >
                                <TagDisplay tags={trade.tags || []} />
                                {(!trade.tags || trade.tags.length === 0) && (
                                  <span className="text-xs text-muted-foreground">Click to add tags</span>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewTrade(trade.id)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
