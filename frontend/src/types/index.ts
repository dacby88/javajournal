export interface User {
  id: number;
  username: string;
  created_at: string;
}

export interface TradeTag {
  id: number;
  name: string;
  color: string;
  description?: string;
  created_at: string;
}

export interface EventTag {
  id: number;
  name: string;
  color: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface Trade {
  id: number;
  trade_date?: string;
  entry_date?: string;
  exit_date?: string;
  symbol: string;
  description?: string;
  override_auto_description?: boolean;
  underlying_symbol?: string;
  side: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  open_qty?: number;
  is_open?: boolean;
  pnl?: number;
  net_pnl: number;
  net_cash?: number;
  gross_pnl?: number;
  commission?: number;
  total_commissions?: number;
  fees?: number;
  duration_minutes?: number;
  entry_time?: string;
  exit_time?: string;
  mae?: number;
  mfe?: number;
  strategy?: string;
  tags?: TradeTag[];
  notes?: string;
  created_at: string;
  account_id?: number;
  account_name?: string;
  asset_class?: string;
  put_call?: string;
  strike?: number;
  expiry?: string;
  open_pnl?: number | null;
  open_positions?: Array<{
    symbol: string;
    description?: string | null;
    side: string;
    qty: number;
    avg_price: number;
    net_cash: number;
    mid: number | null;
    multiplier?: number;
    open_pnl?: number | null;
  }>;
}

export interface DailyStats {
  id: number;
  date: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  break_even_trades: number;
  gross_pnl: number;
  net_pnl: number;
  total_commission: number;
  largest_profit: number;
  largest_loss: number;
  avg_trade_pnl: number;
  execution_count?: number;
}

export interface OverallStats {
  id: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  break_even_trades: number;
  win_rate: number;
  loss_rate: number;
  gross_profit: number;
  gross_loss: number;
  net_pnl: number;
  total_commission: number;
  avg_win: number;
  avg_loss: number;
  largest_profit: number;
  largest_loss: number;
  profit_factor: number;
  expectancy: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  calmar_ratio: number;
  avg_trade_duration: number;
  longest_win_streak: number;
  longest_loss_streak: number;
  longest_win_streak_amount?: number;
  longest_loss_streak_amount?: number;
  current_streak: number;
  current_streak_type: 'win' | 'loss';
  mfe_capture: number;
  mae_recovery: number;
  efficiency_ratio: number;
  avg_risk_reward: number;
  exit_gap: number;
  left_on_table: number;
  good_captures: number;
  updated_at: string;
}

export interface HourlyStats {
  id: number;
  hour: number;
  total_trades: number;
  winning_trades: number;
  net_pnl: number;
  avg_pnl: number;
}

export interface DurationStats {
  id: number;
  duration_range: string;
  total_trades: number;
  winning_trades: number;
  net_pnl: number;
  avg_pnl: number;
}

export interface SymbolPnL {
  symbol: string;
  pnl: number;
}

export interface TradePnlByHour {
  hour: number;
  pnl: number;
}

export interface OpenExecution {
  id: number | string;
  symbol: string;
  description?: string;
  underlying_symbol?: string;
  side: string;
  quantity: number;
  open_qty?: number;
  price: number;
  open_pnl?: number | null;
  trade_date?: string;
  exec_datetime?: string;
  asset_class?: string;
  put_call?: string;
  strike?: number;
  expiry?: string;
  execution_count?: number;
  type?: 'P' | 'T';
  tags?: TradeTag[];
}

export interface DurationPnl {
  bucket: string;
  pnl: number;
  count: number;
}

export interface TagPnl {
  tag: string;
  pnl: number;
  count: number;
  color: string;
}

export interface DashboardData {
  overall: OverallStats;
  daily: DailyStats[];
  calendar: DailyStats[];  // All dates (last 12 months) filtered by account only
  hourly: HourlyStats[];
  duration: DurationStats[];
  recent_trades: Trade[];
  open_trades: OpenExecution[];
  symbol_pnl?: SymbolPnL[];
  trade_pnl_by_hour?: TradePnlByHour[];
  duration_pnl?: DurationPnl[];
  tag_pnl?: TagPnl[];
  last_execution_date?: string;
}

export interface BrokerFormat {
  id: number;
  name: string;
  code: string;
  description?: string;
  column_mappings: Record<string, string>;
  parser_config: Record<string, unknown>;
  value_mappings: Record<string, Record<string, string>>;
  is_active: boolean;
  created_at: string;
}

export interface BrokerImportMapping {
  id: number;
  name: string;
  column_mappings: Record<string, string>;
  value_mappings: Record<string, Record<string, string>>;
  parser_config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BrokerImportMappingPreview {
  headers: string[];
  header_row_index: number;
  sample_rows: Record<string, string[]>;
  suggested_mappings: Record<string, string>;
}

export interface ImportResult {
  success: boolean;
  trades_added?: number;
  executions_added?: number;
  total_rows?: number;
  import_id?: number;
  errors?: string[];
  error?: string;
  trade_processing?: {
    success: boolean;
    executions_found: number;
    groups_processed: number;
    trades_created: number;
    trades_updated: number;
    errors: string[];
  };
  manual_matching?: boolean;
  executions?: Execution[];
}

export interface CSVPreviewRow {
  index: number;
  data: Record<string, string>;
  include: boolean;
  reason: string | null;
}

export interface CSVTemplateInfo {
  required_columns: string[];
  missing_columns: string[];
  detected_format: string;
}

export interface CSVValidationResult {
  valid: boolean;
  fits_template: boolean;
  expected_executions: number;
  total_rows: number;
  skipped_rows: number;
  errors: string[];
  has_timestamps?: boolean;
  template_info: CSVTemplateInfo;
  rows: CSVPreviewRow[];
}

export interface ImportHistory {
  id: number;
  account_id: number;
  account_name?: string;
  filename: string;
  file_size?: number;
  executions_count: number;
  status: 'pending' | 'success' | 'error';
  error_message?: string;
  imported_at: string;
}

export interface CalendarDay {
  date: number;
  dateStr: string;
  net_pnl: number;
  total_trades: number;
  isCurrentMonth: boolean;
}

export interface Account {
  id: number;
  name: string;
  broker_format_id?: number;
  broker_format_name?: string;
  broker_import_mapping_id?: number;
  account_number?: string;
  description?: string;
  timezone?: string;
  is_active: boolean;
  created_at: string;
  settings?: AccountSettings;
}

export interface AccountSettings {
  sortino_target?: number;
  sortino_target_mode?: 'fixed' | 'percent';
  starting_account_value?: number;
}

export interface Execution {
  id: number;
  account_id: number;
  account_name?: string;
  client_account_id?: string;
  account_alias?: string;
  symbol: string;
  description?: string;
  asset_class?: string;
  underlying_symbol?: string;
  strike?: number;
  expiry?: string;
  put_call?: string;
  multiplier?: number;
  trade_id?: string;
  order_id?: string;
  exec_id?: string;
  transaction_type?: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  amount?: number;
  proceeds?: number;
  net_cash?: number;
  commission?: number;
  broker_execution_commission?: number;
  commission_currency?: string;
  currency?: string;
  trade_date: string;
  exec_datetime?: string;
  order_time?: string;
  settle_date?: string;
  exchange?: string;
  notes?: string;
  matched_trade_id?: number;
  is_open?: boolean | null;
  created_at?: string;
}

export interface ExecutionsFilter {
  symbol?: string;
  underlying?: string;
  start_date?: string;
  end_date?: string;
  start_datetime?: string;
  end_datetime?: string;
  entry_time_start?: string;
  entry_time_end?: string;
  exit_time_start?: string;
  exit_time_end?: string;
  duration_min_minutes?: number;
  duration_max_minutes?: number;
  side?: string;
  asset_class?: string;
  account_id?: number;
  account_ids?: number[];
  trade_id?: number;
  matched?: boolean | null;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface TradesFilter {
  symbol?: string;
  underlying?: string;
  start_date?: string;
  end_date?: string;
  start_datetime?: string;
  end_datetime?: string;
  entry_time_start?: string;
  entry_time_end?: string;
  exit_time_start?: string;
  exit_time_end?: string;
  duration_min_minutes?: number;
  duration_max_minutes?: number;
  side?: string;
  account_id?: number;
  account_ids?: number[];
  tag_ids?: number[];
  tag_mode?: 'AND' | 'OR' | 'NONE';
  date_filter_mode?: 'exit_date' | 'entry_date' | 'active_date';
  trade_status?: 'all' | 'open' | 'closed';
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface DailyJournal {
  id: number;
  date: string;
  content: string;
  content_text: string;
  event_tags?: EventTag[];
  created_at: string;
  updated_at: string;
}
