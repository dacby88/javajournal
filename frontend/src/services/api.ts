import type { DashboardData, ImportResult, Trade, DailyStats, Execution, ExecutionsFilter, TradesFilter, BrokerFormat, CSVValidationResult, BrokerImportMapping, BrokerImportMappingPreview } from '@/types';

import { apiFetch } from './http';

const API_BASE_URL = '/api';

class ApiService {
  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await apiFetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Health check
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.fetch('/health');
  }

  // Dashboard
  async getDashboard(year?: number, month?: number, accountIds?: number[], startDate?: string, endDate?: string, excludeMarginTag?: boolean): Promise<{ success: boolean; data: DashboardData }> {
    const params = new URLSearchParams();
    if (year) params.append('year', year.toString());
    if (month) params.append('month', month.toString());
    if (accountIds && accountIds.length > 0) params.append('account_ids', accountIds.join(','));
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (excludeMarginTag) params.append('exclude_margin_tag', 'true');
    return this.fetch(`/dashboard?${params.toString()}`);
  }

  // Stats
  async getOverallStats(): Promise<{ success: boolean; data: any }> {
    return this.fetch('/stats/overall');
  }

  async getDailyStats(year?: number, month?: number): Promise<{ success: boolean; data: DailyStats[] }> {
    const params = new URLSearchParams();
    if (year) params.append('year', year.toString());
    if (month) params.append('month', month.toString());
    return this.fetch(`/stats/daily?${params.toString()}`);
  }

  async getHourlyStats(): Promise<{ success: boolean; data: any[] }> {
    return this.fetch('/stats/hourly');
  }

  async getDurationStats(): Promise<{ success: boolean; data: any[] }> {
    return this.fetch('/stats/duration');
  }

  async recalculateStats(accountId?: number): Promise<{ success: boolean; data?: any; error?: string; message?: string }> {
    return this.fetch('/stats/recalculate', { 
      method: 'POST',
      body: JSON.stringify(accountId ? { account_id: accountId } : {}),
    });
  }

  async reprocessAccount(accountId: number): Promise<{ 
    success: boolean; 
    data?: { 
      account_id: number; 
      account_name: string;
      trades_before: number;
      trades_after: number;
      executions_processed: number;
    }; 
    error?: string; 
    message?: string;
  }> {
    return this.fetch(`/accounts/${accountId}/reprocess`, {
      method: 'POST',
    });
  }

  async recalculateSingleTradePnL(tradeId: number, recalculateStats?: boolean, forceReassign?: boolean): Promise<{ 
    success: boolean; 
    data?: Trade;
    changes?: {
      net_pnl: { old: number; new: number };
      gross_pnl: { old: number; new: number };
      commissions: { old: number; new: number };
    };
    conflicts?: Array<{
      execution_id: number;
      symbol: string;
      current_trade_id: number;
    }>;
    needs_confirmation?: boolean;
    message?: string;
    error?: string;
  }> {
    const response = await apiFetch(`${API_BASE_URL}/trades/${tradeId}/recalculate-pnl`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        recalculate_stats: recalculateStats ?? false,
        force_reassign: forceReassign ?? false,
      }),
    });
    return response.json();
  }

  async recalculateTradePnL(accountId?: number): Promise<{ 
    success: boolean; 
    data?: { 
      total_trades: number; 
      updated: number; 
      unchanged: number; 
      errors: number; 
      total_pnl_diff: number;
    }; 
    error?: string; 
    message?: string;
  }> {
    return this.fetch('/trades/recalculate-pnl', {
      method: 'POST',
      body: JSON.stringify(accountId ? { account_id: accountId } : {}),
    });
  }

  // Trades
  async getTrades(params?: TradesFilter): Promise<{ success: boolean; data: Trade[]; total: number; limit: number; offset: number }> {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (key === 'account_ids') {
          const ids = value as number[];
          if (ids.length > 0) queryParams.append('account_ids', ids.join(','));
        } else if (Array.isArray(value)) {
          value.forEach(v => queryParams.append(key, v.toString()));
        } else {
          queryParams.append(key, value.toString());
        }
      });
    }
    return this.fetch(`/trades?${queryParams.toString()}`);
  }

  // Get all trades for the current filter (without pagination)
  async getAllTrades(startDate?: string, endDate?: string, accountIds?: number[]): Promise<{ success: boolean; data: Trade[] }> {
    const queryParams = new URLSearchParams();
    queryParams.append('limit', '10000'); // Get all trades
    if (startDate) queryParams.append('start_date', startDate);
    if (endDate) queryParams.append('end_date', endDate);
    if (accountIds && accountIds.length > 0) queryParams.append('account_ids', accountIds.join(','));
    return this.fetch(`/trades?${queryParams.toString()}`);
  }

  async getTradeExecutions(tradeId: number): Promise<{ success: boolean; data: Execution[] }> {
    return this.fetch(`/trades/${tradeId}/executions`);
  }

  async getTrade(id: number): Promise<{ success: boolean; data: Trade }> {
    return this.fetch(`/trades/${id}`);
  }

  async updateTrade(id: number, data: Partial<Trade>): Promise<{ success: boolean; data: Trade; message?: string }> {
    return this.fetch(`/trades/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTrade(id: number): Promise<{ success: boolean; message: string }> {
    return this.fetch(`/trades/${id}`, { method: 'DELETE' });
  }

  // Accounts
  async getAccounts(includeInactive = false): Promise<{ success: boolean; data: import('@/types').Account[] }> {
    const params = includeInactive ? '?include_inactive=true' : '';
    return this.fetch(`/accounts${params}`);
  }

  async createAccount(data: { name: string; description?: string; broker_format_id?: number; broker_import_mapping_id?: number; account_number?: string; timezone?: string; settings?: import('@/types').AccountSettings }): Promise<{ success: boolean; data: import('@/types').Account }> {
    return this.fetch('/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAccount(accountId: number, data: { name?: string; description?: string; broker_format_id?: number; broker_import_mapping_id?: number; account_number?: string; is_active?: boolean; timezone?: string; settings?: import('@/types').AccountSettings }): Promise<{ success: boolean; data: import('@/types').Account }> {
    return this.fetch(`/accounts/${accountId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteAccount(accountId: number): Promise<{ success: boolean }> {
    return this.fetch(`/accounts/${accountId}`, {
      method: 'DELETE',
    });
  }

  // Imports
  async getImports(): Promise<{ success: boolean; data: import('@/types').ImportHistory[] }> {
    return this.fetch('/imports');
  }

  async deleteImport(importId: number): Promise<{ success: boolean; message?: string }> {
    return this.fetch(`/imports/${importId}`, {
      method: 'DELETE',
    });
  }

  // Broker Formats
  async getBrokerFormats(): Promise<{ success: boolean; data: BrokerFormat[] }> {
    return this.fetch('/broker-formats');
  }

  async getBrokerFormat(id: number): Promise<{ success: boolean; data: BrokerFormat }> {
    return this.fetch(`/broker-formats/${id}`);
  }

  // Broker Import Mappings
  async getAllBrokerImportMappings(): Promise<{ success: boolean; data: BrokerImportMapping[] }> {
    return this.fetch('/broker-import-mappings');
  }

  async createBrokerImportMapping(data: Partial<BrokerImportMapping>): Promise<{ success: boolean; data: BrokerImportMapping }> {
    return this.fetch('/broker-import-mappings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateBrokerImportMapping(mappingId: number, data: Partial<BrokerImportMapping>): Promise<{ success: boolean; data: BrokerImportMapping }> {
    return this.fetch(`/broker-import-mappings/${mappingId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteBrokerImportMapping(mappingId: number): Promise<{ success: boolean; message?: string }> {
    return this.fetch(`/broker-import-mappings/${mappingId}`, {
      method: 'DELETE',
    });
  }

  async previewBrokerImportMappingFile(file: File): Promise<{ success: boolean; data: BrokerImportMappingPreview }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiFetch(`${API_BASE_URL}/broker-import-mappings/preview`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  // CSV Import
  async importCSV(file: File, accountId?: number, brokerFormatId?: number, brokerImportMappingId?: number, selectedRowIndices?: number[], advancedMatching?: boolean, manualMatching?: boolean): Promise<ImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    if (accountId) {
      formData.append('account_id', accountId.toString());
    }
    if (brokerFormatId) {
      formData.append('broker_format_id', brokerFormatId.toString());
    }
    if (brokerImportMappingId) {
      formData.append('broker_import_mapping_id', brokerImportMappingId.toString());
    }
    if (selectedRowIndices && selectedRowIndices.length > 0) {
      formData.append('selected_rows', JSON.stringify(selectedRowIndices));
    }
    if (advancedMatching) {
      formData.append('advanced_matching', 'true');
    }
    if (manualMatching) {
      formData.append('manual_matching', 'true');
    }

    const response = await apiFetch(`${API_BASE_URL}/import/csv`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // CSV Validation (pre-import check)
  async validateCSV(file: File, accountId?: number, brokerFormatId?: number, brokerImportMappingId?: number): Promise<{ success: boolean; data: CSVValidationResult }> {
    const formData = new FormData();
    formData.append('file', file);
    if (accountId) {
      formData.append('account_id', accountId.toString());
    }
    if (brokerFormatId) {
      formData.append('broker_format_id', brokerFormatId.toString());
    }
    if (brokerImportMappingId) {
      formData.append('broker_import_mapping_id', brokerImportMappingId.toString());
    }

    const response = await apiFetch(`${API_BASE_URL}/import/validate`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async downloadTemplate(): Promise<Blob> {
    const response = await apiFetch(`${API_BASE_URL}/import/template`, {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('Failed to download template');
    }
    return response.blob();
  }

  // Charts
  async getEquityCurve(): Promise<{ success: boolean; data: any[] }> {
    return this.fetch('/charts/equity');
  }

  async getPnLDistribution(): Promise<{ success: boolean; data: any[] }> {
    return this.fetch('/charts/pnl-distribution');
  }

  // Symbols
  async getSymbols(): Promise<{ success: boolean; data: string[] }> {
    return this.fetch('/symbols');
  }

  // Executions
  async getExecutions(filter?: ExecutionsFilter): Promise<{ 
    success: boolean; 
    data: Execution[]; 
    total: number; 
    limit: number; 
    offset: number 
  }> {
    const params = new URLSearchParams();
    if (filter) {
      Object.entries(filter).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (key === 'account_ids') {
          const ids = value as number[];
          if (ids.length > 0) params.append('account_ids', ids.join(','));
        } else {
          params.append(key, value.toString());
        }
      });
    }
    return this.fetch(`/executions?${params.toString()}`);
  }

  async getExecution(id: number): Promise<{ success: boolean; data: Execution }> {
    return this.fetch(`/executions/${id}`);
  }

  async createExecution(data: Partial<Execution>): Promise<{
    success: boolean;
    data: Execution;
    message?: string;
  }> {
    return this.fetch('/executions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateExecution(id: number, data: Partial<Execution>): Promise<{ 
    success: boolean; 
    data: Execution;
    message?: string;
  }> {
    return this.fetch(`/executions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteExecution(id: number): Promise<{ success: boolean; message: string }> {
    return this.fetch(`/executions/${id}`, { method: 'DELETE' });
  }

  async toggleExecutionOpen(id: number): Promise<{ success: boolean; data: Execution; message?: string }> {
    return this.fetch(`/executions/${id}/toggle-open`, { method: 'POST' });
  }

  async unassignExecution(id: number): Promise<{ success: boolean; data?: Execution; error?: string; warning?: string; message?: string }> {
    return this.fetch(`/executions/${id}/unassign`, { method: 'POST' });
  }

  async unassignExecutions(tradeId: number, executionIds: number[]): Promise<{ success: boolean; data?: Execution[]; error?: string; warning?: string; message?: string }> {
    return this.fetch(`/trades/${tradeId}/unassign`, {
      method: 'POST',
      body: JSON.stringify({ execution_ids: executionIds }),
    });
  }

  async combineExecutions(executionIds: number[]): Promise<{ success: boolean; data?: Trade; error?: string; message?: string }> {
    return this.fetch('/executions/combine', {
      method: 'POST',
      body: JSON.stringify({ execution_ids: executionIds }),
    });
  }

  async splitExecution(id: number, quantities: number[]): Promise<{
    success: boolean;
    data: Execution[];
    error?: string;
  }> {
    return this.fetch(`/executions/${id}/split`, {
      method: 'POST',
      body: JSON.stringify({ quantities }),
    });
  }

  // Daily Journal
  async getJournal(date: string): Promise<{ success: boolean; data: import('@/types').DailyJournal | null }> {
    return this.fetch(`/journal/${date}`);
  }

  async saveJournal(data: { date: string; content: string; content_text: string; event_tag_ids?: number[] }): Promise<{ success: boolean; data: import('@/types').DailyJournal }> {
    return this.fetch('/journal', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteJournal(date: string): Promise<{ success: boolean; message?: string }> {
    return this.fetch(`/journal/${date}`, { method: 'DELETE' });
  }

  async getJournals(startDate?: string, endDate?: string): Promise<{ success: boolean; data: import('@/types').DailyJournal[] }> {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    return this.fetch(`/journals?${params.toString()}`);
  }

  // Trade Tags
  async getTags(): Promise<{ success: boolean; data: import('@/types').TradeTag[] }> {
    return this.fetch('/tags');
  }

  async createTag(data: { name: string; color?: string; description?: string }): Promise<{ success: boolean; data: import('@/types').TradeTag; message?: string }> {
    return this.fetch('/tags', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTag(tagId: number, data: { name?: string; color?: string; description?: string }): Promise<{ success: boolean; data: import('@/types').TradeTag; message?: string }> {
    return this.fetch(`/tags/${tagId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTag(tagId: number): Promise<{ success: boolean; message?: string }> {
    return this.fetch(`/tags/${tagId}`, { method: 'DELETE' });
  }

  async getTradeTags(tradeId: number): Promise<{ success: boolean; data: import('@/types').TradeTag[] }> {
    return this.fetch(`/trades/${tradeId}/tags`);
  }

  async setTradeTags(tradeId: number, tagIds: number[]): Promise<{ success: boolean; data: import('@/types').TradeTag[]; message?: string }> {
    return this.fetch(`/trades/${tradeId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tag_ids: tagIds }),
    });
  }

  // Event Tags
  async getEventTags(): Promise<{ success: boolean; data: import('@/types').EventTag[] }> {
    return this.fetch('/event-tags');
  }

  async createEventTag(data: { name: string; color?: string; description?: string }): Promise<{ success: boolean; data: import('@/types').EventTag; message?: string }> {
    return this.fetch('/event-tags', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateEventTag(tagId: number, data: { name?: string; color?: string; description?: string }): Promise<{ success: boolean; data: import('@/types').EventTag; message?: string }> {
    return this.fetch(`/event-tags/${tagId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteEventTag(tagId: number): Promise<{ success: boolean; message?: string }> {
    return this.fetch(`/event-tags/${tagId}`, { method: 'DELETE' });
  }

  // Create a new manual trade
  async createTrade(data: { account_id: number; description?: string; side?: string; entry_date?: string; exit_date?: string; notes?: string }): Promise<{ success: boolean; data: Trade; message?: string }> {
    return this.fetch('/trades', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Assign executions to an existing trade
  async assignExecutionsToTrade(tradeId: number, executionIds: number[]): Promise<{ success: boolean; data: Trade; message?: string }> {
    return this.fetch(`/trades/${tradeId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ execution_ids: executionIds }),
    });
  }

  // Get unmatched executions
  async getUnmatchedExecutions(accountId?: number): Promise<{ success: boolean; data: Execution[] }> {
    const params = new URLSearchParams();
    if (accountId) params.append('account_id', accountId.toString());
    return this.fetch(`/executions/unmatched?${params.toString()}`);
  }

  // Trade Combination
  async combineTrades(tradeIds: number[]): Promise<{ success: boolean; data: Trade; message?: string }> {
    return this.fetch('/trades/combine', {
      method: 'POST',
      body: JSON.stringify({ trade_ids: tradeIds }),
    });
  }

  async uncombineTrade(tradeId: number): Promise<{ success: boolean; data: Trade[]; message?: string }> {
    return this.fetch(`/trades/${tradeId}/uncombine`, {
      method: 'POST',
    });
  }

  async getTradeCombineHistory(tradeId: number): Promise<{ 
    success: boolean; 
    data: { 
      is_combined: boolean; 
      can_uncombine: boolean; 
      original_trade_count?: number;
      combined_at?: string;
      reason?: string;
      undone_at?: string;
    } 
  }> {
    return this.fetch(`/trades/${tradeId}/combine-history`);
  }

  async unmatchTrade(tradeId: number): Promise<{ 
    success: boolean; 
    message?: string; 
    executions_unmatched?: number 
  }> {
    return this.fetch(`/trades/${tradeId}/unmatch`, {
      method: 'POST',
    });
  }
}

export const api = new ApiService();
export default api;
