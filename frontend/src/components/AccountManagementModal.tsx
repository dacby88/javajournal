import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Edit2, Trash2, Wallet, Building2, CreditCard, AlertCircle, ChevronDown, ChevronRight, Upload, FileText, Calendar, RefreshCw, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { api } from '@/services/api';
import { parseSortinoSettings } from '@/lib/sortino';
import type { Account, ImportHistory, BrokerFormat, BrokerImportMapping } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { BrokerImportMappingModal } from './BrokerImportMappingModal';

interface AccountManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccountsChanged: () => void;
}

export function AccountManagementModal({ isOpen, onClose, onAccountsChanged }: AccountManagementModalProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [imports, setImports] = useState<ImportHistory[]>([]);
  const [brokerFormats, setBrokerFormats] = useState<BrokerFormat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState<Account | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [importDeleteConfirm, setImportDeleteConfirm] = useState<number | null>(null);
  const [showImports, setShowImports] = useState(false);
  const [showMappings, setShowMappings] = useState(false);
  const [mappings, setMappings] = useState<BrokerImportMapping[]>([]);
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<BrokerImportMapping | null>(null);
  const [mappingDeleteConfirm, setMappingDeleteConfirm] = useState<number | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcSuccess, setRecalcSuccess] = useState(false);
  const [recalcAccountId, setRecalcAccountId] = useState<number | ''>('');
  const [reprocessConfirm, setReprocessConfirm] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    broker_format_id: '',
    broker_import_mapping_id: '',
    account_number: '',
    timezone: 'America/New_York',
    sortino_target: '1000',
    sortino_target_mode: 'fixed' as 'fixed' | 'percent',
    starting_account_value: '',
    is_active: true,
  });
  
  const [activeTab, setActiveTab] = useState<'edit' | 'defaults'>('edit');

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getAccounts(true);
      if (response.success) {
        setAccounts(response.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBrokerFormats = useCallback(async () => {
    try {
      const response = await api.getBrokerFormats();
      if (response.success) {
        setBrokerFormats(response.data);
      }
    } catch (err) {
      console.error('Failed to load broker formats:', err);
    }
  }, []);

  const loadImports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getImports();
      if (response.success) {
        setImports(response.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load imports');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMappings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getAllBrokerImportMappings();
      if (response.success) {
        setMappings(response.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load broker import mappings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadAccounts();
      loadBrokerFormats();
      loadMappings();
      if (showImports) {
        loadImports();
      }
    }
  }, [isOpen, loadAccounts, loadBrokerFormats, showImports]);

  const toggleImports = () => {
    setShowImports(!showImports);
    if (!showImports) {
      loadImports();
    }
  };

  const toggleMappings = () => {
    setShowMappings(!showMappings);
    if (!showMappings) {
      loadMappings();
    }
  };

  const handleOpenNewMapping = () => {
    setEditingMapping(null);
    setMappingModalOpen(true);
  };

  const handleOpenEditMapping = (mapping: BrokerImportMapping) => {
    setEditingMapping(mapping);
    setMappingModalOpen(true);
  };

  const handleMappingSaved = async () => {
    await loadMappings();
  };

  const handleDeleteMapping = async (mapping: BrokerImportMapping) => {
    setLoading(true);
    setError(null);
    try {
      await api.deleteBrokerImportMapping(mapping.id);
      setMappingDeleteConfirm(null);
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete mapping');
    } finally {
      setLoading(false);
    }
  };

  const handleReprocess = async () => {
    if (!recalcAccountId) {
      setError('Please select an account to reprocess');
      return;
    }
    
    setIsRecalculating(true);
    setError(null);
    setRecalcSuccess(false);
    setReprocessConfirm(false);
    
    try {
      const response = await api.reprocessAccount(Number(recalcAccountId));
      if (response.success) {
        await onAccountsChanged(); // Refresh dashboard data
        setRecalcSuccess(true);
        setTimeout(() => setRecalcSuccess(false), 5000); // Clear after 5 seconds
      } else {
        setError(response.error || 'Failed to reprocess account');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reprocess account');
    } finally {
      setIsRecalculating(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', description: '', broker_format_id: '', broker_import_mapping_id: '', account_number: '', timezone: 'America/New_York', sortino_target: '1000', sortino_target_mode: 'fixed', starting_account_value: '', is_active: true });
    setIsEditing(null);
    setIsCreating(false);
    setDeleteConfirm(null);
    setImportDeleteConfirm(null);
    setMappingDeleteConfirm(null);
    setActiveTab('edit');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      setError('Account name is required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = {
        name: formData.name,
        description: formData.description,
        broker_format_id: formData.broker_format_id ? parseInt(formData.broker_format_id) : undefined,
        broker_import_mapping_id: formData.broker_import_mapping_id ? parseInt(formData.broker_import_mapping_id) : undefined,
        account_number: formData.account_number,
        timezone: formData.timezone,
        settings: parseSortinoSettings(formData),
      };
      await api.createAccount(data);
      resetForm();
      await loadAccounts();
      onAccountsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!isEditing) return;
    if (!formData.name.trim()) {
      setError('Account name is required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = {
        name: formData.name,
        description: formData.description,
        broker_format_id: formData.broker_format_id ? parseInt(formData.broker_format_id) : undefined,
        broker_import_mapping_id: formData.broker_import_mapping_id ? parseInt(formData.broker_import_mapping_id) : undefined,
        account_number: formData.account_number,
        timezone: formData.timezone,
        is_active: formData.is_active,
        settings: parseSortinoSettings(formData),
      };
      await api.updateAccount(isEditing.id, data);
      resetForm();
      await loadAccounts();
      onAccountsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (accountId: number) => {
    setLoading(true);
    setError(null);
    try {
      await api.deleteAccount(accountId);
      setDeleteConfirm(null);
      await loadAccounts();
      onAccountsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteImport = async (importId: number) => {
    setLoading(true);
    setError(null);
    try {
      await api.deleteImport(importId);
      setImportDeleteConfirm(null);
      await loadImports();
      onAccountsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete import');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (account: Account) => {
    setIsEditing(account);
    setIsCreating(false);
    setActiveTab('edit');
    setFormData({
      name: account.name,
      description: account.description || '',
      broker_format_id: account.broker_format_id?.toString() || '',
      broker_import_mapping_id: account.broker_import_mapping_id?.toString() || '',
      account_number: account.account_number || '',
      timezone: account.timezone || 'America/New_York',
      sortino_target: account.settings?.sortino_target?.toString() || '1000',
      sortino_target_mode: account.settings?.sortino_target_mode || 'fixed',
      starting_account_value: account.settings?.starting_account_value?.toString() || '',
      is_active: account.is_active !== false,
    });
  };

  const startCreate = () => {
    setIsCreating(true);
    setIsEditing(null);
    setActiveTab('edit');
    setFormData({ name: '', description: '', broker_format_id: '', broker_import_mapping_id: '', account_number: '', timezone: 'America/New_York', sortino_target: '1000', sortino_target_mode: 'fixed', starting_account_value: '', is_active: true });
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return formatDateTime(dateStr) || dateStr;
  };

  const sortedAccounts = [...accounts].sort((a, b) => {
    const aActive = a.is_active !== false;
    const bActive = b.is_active !== false;
    if (aActive !== bActive) return aActive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const activeAccounts = sortedAccounts.filter((a) => a.is_active !== false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Manage Accounts & Imports</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mx-4 mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {/* Create/Edit Form */}
          {(isCreating || isEditing) && (
            <div className="mb-6 p-4 bg-secondary/30 rounded-lg border border-border">
              {/* Tabs */}
              <div className="flex items-center gap-1 mb-4 border-b border-border">
                <button
                  onClick={() => setActiveTab('edit')}
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'edit'
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {isCreating ? 'Create Account' : 'Edit Account'}
                </button>
                {!isCreating && (
                  <button
                    onClick={() => setActiveTab('defaults')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === 'defaults'
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Account Defaults
                  </button>
                )}
              </div>
              
              {activeTab === 'edit' ? (
              <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Account Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., TD Ameritrade IRA"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Broker Format</label>
                  <select
                    value={formData.broker_format_id}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData(prev => ({
                        ...prev,
                        broker_format_id: value,
                        // Clear mapping if a broker format is selected
                        broker_import_mapping_id: value ? '' : prev.broker_import_mapping_id,
                      }));
                    }}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select a broker format...</option>
                    {brokerFormats.map((format) => (
                      <option key={format.id} value={format.id}>
                        {format.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Broker Import Mapping</label>
                  <select
                    value={formData.broker_import_mapping_id}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData(prev => ({
                        ...prev,
                        broker_import_mapping_id: value,
                        // Clear broker format if a mapping is selected
                        broker_format_id: value ? '' : prev.broker_format_id,
                      }));
                    }}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select a custom mapping...</option>
                    {mappings.map((mapping) => (
                      <option key={mapping.id} value={mapping.id}>
                        {mapping.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Overrides broker format for CSV imports.
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Account Number</label>
                  <input
                    type="text"
                    value={formData.account_number}
                    onChange={(e) => setFormData({ ...formData, account_number: e.target.value })}
                    placeholder="e.g., ****1234"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Description</label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Optional description"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Timezone</label>
                  <select
                    value={formData.timezone}
                    onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="America/New_York">Eastern Time (ET)</option>
                    <option value="America/Chicago">Central Time (CT)</option>
                    <option value="America/Denver">Mountain Time (MT)</option>
                    <option value="America/Los_Angeles">Pacific Time (PT)</option>
                    <option value="UTC">UTC (GMT)</option>
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Tastytrade exports in UTC/GMT. IB exports in ET.
                  </p>
                </div>
                {isEditing && (
                  <div className="sm:col-span-2">
                    <Label className="flex items-center gap-2 text-sm font-normal cursor-pointer">
                      <Checkbox
                        checked={!formData.is_active}
                        onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked !== true })}
                        aria-label="Mark account inactive"
                      />
                      Inactive — hide this account from dropdowns
                    </Label>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" size="sm" onClick={resetForm} disabled={loading}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={isCreating ? handleCreate : handleUpdate}
                  disabled={loading || !formData.name.trim()}
                  className="btn-primary"
                >
                  {isCreating ? 'Create Account' : 'Save Changes'}
                </Button>
              </div>
              </div>
              ) : (
              /* Account Defaults Tab */
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Starting Account Value ($)</label>
                    <input
                      type="number"
                      value={formData.starting_account_value}
                      onChange={(e) => setFormData({ ...formData, starting_account_value: e.target.value })}
                      placeholder="e.g. 50000"
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Equity before your imported history. Annual Sortino benchmarks use this value plus cumulative realized account P&L.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      Sortino Ratio Benchmark ({formData.sortino_target_mode === 'percent' ? 'annual %' : '$/day'})
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={formData.sortino_target}
                        step="0.01"
                        onChange={(e) => setFormData({ ...formData, sortino_target: e.target.value })}
                        placeholder={formData.sortino_target_mode === 'percent' ? '1' : '1000'}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <select
                        value={formData.sortino_target_mode}
                        onChange={(e) => setFormData({ ...formData, sortino_target_mode: e.target.value as 'fixed' | 'percent', sortino_target: e.target.value === 'percent' ? '1' : '1000' })}
                        className="px-2 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                      >
                        <option value="fixed">Fixed $</option>
                        <option value="percent">Annual %</option>
                      </select>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {formData.sortino_target_mode === 'percent'
                        ? 'Annual return benchmark, compounded to a daily rate over 252 trading days and applied to starting value plus prior realized P&L. Requires a positive starting value.'
                        : 'Daily P&L target for Sortino ratio calculation'}
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={resetForm} disabled={loading}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleUpdate}
                    disabled={loading}
                    className="btn-primary"
                  >
                    Save Changes
                  </Button>
                </div>
              </div>
              )}
            </div>
          )}

          {/* Accounts List */}
          <div className="space-y-2 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                {accounts.length} Account{accounts.length !== 1 ? 's' : ''}
              </h3>
              {!isCreating && !isEditing && (
                <Button size="sm" onClick={startCreate} className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Account
                </Button>
              )}
            </div>

            {accounts.length === 0 && !isCreating ? (
              <div className="text-center py-8 text-muted-foreground">
                <Wallet className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No accounts yet</p>
                <p className="text-xs mt-1">Create your first account to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sortedAccounts.map((account, index) => (
                  <div key={account.id}>
                    {index > 0 && account.is_active === false && sortedAccounts[index - 1].is_active !== false && (
                      <p className="text-xs font-medium text-muted-foreground pt-2 pb-1">Inactive</p>
                    )}
                  <div
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      account.is_active !== false
                        ? 'bg-card border-border'
                        : 'bg-secondary/30 border-border/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                        {account.broker_format_name ? (
                          <Building2 className="h-5 w-5 text-primary" />
                        ) : (
                          <CreditCard className="h-5 w-5 text-primary" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${account.is_active === false ? 'text-muted-foreground' : ''}`}>
                            {account.name}
                          </span>
                          {account.is_active === false && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium">
                              Inactive
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {account.broker_format_name && <span>{account.broker_format_name}</span>}
                          {account.account_number && (
                            <span className={account.broker_format_name ? 'ml-2' : ''}>
                              #{account.account_number}
                            </span>
                          )}
                        </div>
                        {account.description && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {account.description}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {deleteConfirm === account.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-destructive mr-1">Delete?</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteConfirm(null)}
                            className="h-8 px-2"
                          >
                            No
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(account.id)}
                            disabled={loading}
                            className="h-8 px-2"
                          >
                            Yes
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(account)}
                            disabled={loading || isCreating || isEditing !== null}
                            className="h-8 w-8 p-0"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteConfirm(account.id)}
                            disabled={loading || isCreating || isEditing !== null}
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Broker Import Mappings Section */}
          <div className="border-t border-border pt-4">
            <button
              onClick={toggleMappings}
              className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                <span className="font-medium">Broker Import Mappings</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenNewMapping();
                  }}
                  className="h-7 px-2 text-xs"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  New
                </Button>
                {showMappings ? (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
            </button>

            {showMappings && (
              <div className="mt-3 space-y-2">
                {mappings.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <FileSpreadsheet className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No broker import mappings yet</p>
                    <p className="text-xs mt-1">Create a mapping to import custom CSV formats</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {mappings.map((mapping) => (
                      <div
                        key={mapping.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-border bg-card"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-secondary flex-shrink-0">
                            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <span className="font-medium text-sm truncate">
                              {mapping.name}
                            </span>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{Object.keys(mapping.column_mappings || {}).length} columns mapped</span>
                              <span>·</span>
                              <span>{formatDate(mapping.updated_at)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenEditMapping(mapping)}
                            disabled={loading}
                            className="h-8 w-8 p-0"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          {mappingDeleteConfirm === mapping.id ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-destructive mr-1">Delete?</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setMappingDeleteConfirm(null)}
                                className="h-7 px-2"
                              >
                                No
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDeleteMapping(mapping)}
                                disabled={loading}
                                className="h-7 px-2"
                              >
                                Yes
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setMappingDeleteConfirm(mapping.id)}
                              disabled={loading}
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Imports Section */}
          <div className="border-t border-border pt-4">
            <button
              onClick={toggleImports}
              className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                <span className="font-medium">Import History</span>
              </div>
              {showImports ? (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              )}
            </button>

            {showImports && (
              <div className="mt-3 space-y-2">
                {imports.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No imports yet</p>
                    <p className="text-xs mt-1">Import CSV files to see them here</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {imports.map((importItem) => (
                      <div
                        key={importItem.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-border bg-card"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-secondary flex-shrink-0">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">
                                {importItem.filename}
                              </span>
                              {importItem.status === 'error' && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-destructive/10 text-destructive rounded-full">
                                  Error
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDate(importItem.imported_at)}
                              </span>
                              <span>{formatFileSize(importItem.file_size)}</span>
                              <span>{importItem.executions_count} executions</span>
                              <span className="truncate max-w-[120px] font-medium text-foreground">
                                {importItem.account_name || 'Unknown Account'}
                              </span>
                            </div>
                            {importItem.error_message && (
                              <div className="text-xs text-destructive mt-0.5">
                                {importItem.error_message}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                          {importDeleteConfirm === importItem.id ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-destructive mr-1">Delete?</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setImportDeleteConfirm(null)}
                                className="h-7 px-2"
                              >
                                No
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDeleteImport(importItem.id)}
                                disabled={loading}
                                className="h-7 px-2"
                              >
                                Yes
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setImportDeleteConfirm(importItem.id)}
                              disabled={loading}
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <BrokerImportMappingModal
        isOpen={mappingModalOpen}
        onClose={() => {
          setMappingModalOpen(false);
          setEditingMapping(null);
        }}
        mapping={editingMapping}
        onSaved={handleMappingSaved}
      />

      {/* Footer */}
        <div className="p-4 border-t border-border bg-secondary/30">
          <div className="flex flex-col gap-3">
            {/* Reprocess Section */}
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={recalcAccountId}
                onChange={(e) => {
                  setRecalcAccountId(e.target.value ? parseInt(e.target.value) : '');
                  setReprocessConfirm(false);
                  setRecalcSuccess(false);
                }}
                disabled={isRecalculating}
                className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select Account...</option>
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
              
              {!reprocessConfirm ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!recalcAccountId) {
                      setError('Please select an account first');
                      return;
                    }
                    setReprocessConfirm(true);
                    setError(null);
                  }}
                  disabled={isRecalculating || activeAccounts.length === 0}
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reprocess & Recalc
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-destructive font-medium">
                    Delete all trades and reprocess?
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReprocessConfirm(false)}
                    disabled={isRecalculating}
                    className="h-8 px-2"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleReprocess}
                    disabled={isRecalculating}
                    className="h-8 px-2"
                  >
                    <RefreshCw className={`h-4 w-4 mr-1 ${isRecalculating ? 'animate-spin' : ''}`} />
                    {isRecalculating ? 'Processing...' : 'Confirm'}
                  </Button>
                </div>
              )}
              
              {recalcSuccess && (
                <span className="text-xs text-profit">
                  Account reprocessed successfully
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>Reprocess & Recalc:</strong> Deletes all trades for the selected account, 
              re-matches executions, and recalculates stats. Use this to fix P&L discrepancies.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
