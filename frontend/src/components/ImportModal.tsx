import { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Download, CheckCircle, AlertCircle, FileUp, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/services/api';
import { ManualTradeMatcher } from './ManualTradeMatcher';
import type { ImportResult, Account, BrokerFormat, BrokerImportMapping, CSVValidationResult } from '@/types';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultAccountId?: number | null;
}

type ImportStage = 'select' | 'validating' | 'preview' | 'importing' | 'matching' | 'result';

export function ImportModal({ isOpen, onClose, onSuccess, defaultAccountId }: ImportModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState<ImportStage>('select');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [validationResult, setValidationResult] = useState<CSVValidationResult | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<number | ''>('');
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [brokerFormats, setBrokerFormats] = useState<BrokerFormat[]>([]);
  const [selectedBrokerFormat, setSelectedBrokerFormat] = useState<number | ''>('');
  const [loadingBrokerFormats, setLoadingBrokerFormats] = useState(false);
  const [mappings, setMappings] = useState<BrokerImportMapping[]>([]);
  const [selectedMapping, setSelectedMapping] = useState<number | ''>('');
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [advancedMatching, setAdvancedMatching] = useState(false);
  const [manualMatching, setManualMatching] = useState(false);
  const pendingRefresh = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load accounts, broker formats, and mappings when modal opens
  useEffect(() => {
    if (isOpen) {
      loadAccounts();
      loadBrokerFormats();
      loadMappings();
      // Reset state when modal opens
      setStage('select');
      setResult(null);
      setValidationResult(null);
      setPendingFile(null);
      setSelectedRows(new Set());
      setAdvancedMatching(false);
      setManualMatching(false);
      pendingRefresh.current = false;
    }
  }, [isOpen]);

  // Initialize selected rows from validation result
  useEffect(() => {
    if (validationResult?.rows) {
      const included = new Set<number>();
      validationResult.rows.forEach(row => {
        if (row.include) {
          included.add(row.index);
        }
      });
      setSelectedRows(included);
    }
  }, [validationResult]);

  // Auto-select broker format and mapping when account changes
  useEffect(() => {
    if (selectedAccount) {
      const account = accounts.find(a => a.id === selectedAccount);
      if (account?.broker_format_id && brokerFormats.length > 0) {
        setSelectedBrokerFormat(account.broker_format_id);
        setSelectedMapping('');
      } else if (account?.broker_import_mapping_id && mappings.length > 0) {
        setSelectedMapping(account.broker_import_mapping_id);
        setSelectedBrokerFormat('');
      } else {
        setSelectedBrokerFormat('');
        setSelectedMapping('');
      }
    } else {
      setSelectedBrokerFormat('');
      setSelectedMapping('');
    }
  }, [selectedAccount, brokerFormats, mappings, accounts]);



  const loadAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const response = await api.getAccounts();
      if (response.success) {
        setAccounts(response.data);
        // Use defaultAccountId if provided and valid, otherwise auto-select first active
        if (defaultAccountId && response.data.find(a => a.id === defaultAccountId)) {
          setSelectedAccount(defaultAccountId);
        } else {
          const firstActive = response.data.find(a => a.is_active);
          if (firstActive) {
            setSelectedAccount(firstActive.id);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const loadBrokerFormats = async () => {
    setLoadingBrokerFormats(true);
    try {
      const response = await api.getBrokerFormats();
      if (response.success) {
        setBrokerFormats(response.data);
      }
    } catch (error) {
      console.error('Failed to load broker formats:', error);
    } finally {
      setLoadingBrokerFormats(false);
    }
  };

  const loadMappings = async () => {
    setLoadingMappings(true);
    try {
      const response = await api.getAllBrokerImportMappings();
      if (response.success) {
        setMappings(response.data);
      }
    } catch (error) {
      console.error('Failed to load broker import mappings:', error);
    } finally {
      setLoadingMappings(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelectForValidation(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelectForValidation(files[0]);
    }
  };

  const handleFileSelectForValidation = async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setResult({
        success: false,
        error: 'Please upload a CSV file',
      });
      setStage('result');
      return;
    }

    if (!selectedAccount) {
      setResult({
        success: false,
        error: 'Please select an account',
      });
      setStage('result');
      return;
    }

    // Store file and start validation
    setPendingFile(file);
    setStage('validating');
    setValidationResult(null);

    try {
      const validationResponse = await api.validateCSV(
        file,
        selectedAccount as number,
        selectedBrokerFormat ? selectedBrokerFormat as number : undefined,
        selectedMapping ? selectedMapping as number : undefined
      );

      if (validationResponse.success) {
        setValidationResult(validationResponse.data);
        // Auto-enable advanced matching when the file has real execution times
        setAdvancedMatching(!!validationResponse.data.has_timestamps);
        setStage('preview');
      } else {
        setResult({
          success: false,
          error: 'Validation failed',
        });
        setStage('result');
      }
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Validation failed',
      });
      setStage('result');
    }
  };

  const handleConfirmedUpload = async () => {
    if (!pendingFile || !selectedAccount) return;

    setStage('importing');
    setResult(null);

    try {
      const importResult = await api.importCSV(
        pendingFile,
        selectedAccount as number,
        selectedBrokerFormat ? selectedBrokerFormat as number : undefined,
        selectedMapping ? selectedMapping as number : undefined,
        Array.from(selectedRows),
        advancedMatching && !manualMatching,
        manualMatching
      );
      setResult(importResult);
      if (importResult.success && manualMatching && (importResult.executions?.length || 0) > 0) {
        pendingRefresh.current = true;
        setStage('matching');
      } else {
        setStage('result');
        if (importResult.success) {
          onSuccess();
        }
      }
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      });
      setStage('result');
    }
  };

  const handleCancelUpload = () => {
    setPendingFile(null);
    setValidationResult(null);
    setSelectedRows(new Set());
    setAdvancedMatching(false);
    setManualMatching(false);
    setStage('select');
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const toggleRow = (index: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const toggleAllRows = () => {
    if (!validationResult?.rows) return;
    const allIndices = validationResult.rows.map(r => r.index);
    const allSelected = allIndices.every(idx => selectedRows.has(idx));
    if (allSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(allIndices));
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await api.downloadTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'trade_template.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to download template:', error);
    }
  };

  const handleClose = () => {
    const refresh = pendingRefresh.current;
    pendingRefresh.current = false;
    setStage('select');
    setResult(null);
    setValidationResult(null);
    setPendingFile(null);
    setAdvancedMatching(false);
    setManualMatching(false);
    if (refresh) {
      onSuccess();
    } else {
      onClose();
    }
  };

  const handleTryAgain = () => {
    setStage('select');
    setResult(null);
    setValidationResult(null);
    setPendingFile(null);
    setAdvancedMatching(false);
    setManualMatching(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Get selected account name for display
  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className={`${stage === 'preview' || stage === 'matching' ? 'w-[95vw] max-w-[95vw] sm:max-w-[95vw]' : 'sm:max-w-lg w-[90vw]'} ${stage === 'matching' ? 'h-[90vh] max-h-[90vh] overflow-hidden flex flex-col' : 'max-h-[90vh] overflow-y-auto'} bg-card border-border transition-all duration-300`}>
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {stage === 'matching'
              ? (accounts.find((account) => account.id === selectedAccount)?.name || 'Account')
              : 'Import Trades from CSV'}
          </DialogTitle>
        </DialogHeader>

        <div className={stage === 'matching' ? 'flex min-h-0 flex-1 flex-col' : 'space-y-4'}>
          {stage !== 'matching' && (<>
          {/* Template Download */}
          <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg max-w-[700px]">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Need a template?</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadTemplate}
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          </div>

          {/* Account Selection */}
          <div className="space-y-2 max-w-[700px]">
            <label className="text-sm font-medium">Select Account</label>
            <select
              value={selectedAccount}
              onChange={(e) => {
                setSelectedAccount(Number(e.target.value));
                // Reset file when account changes
                if (pendingFile) {
                  handleCancelUpload();
                }
              }}
              disabled={loadingAccounts || stage === 'validating' || stage === 'importing'}
              className="w-full p-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">-- Select an account --</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            {loadingAccounts && (
              <p className="text-xs text-muted-foreground">Loading accounts...</p>
            )}
          </div>

          {/* Broker Format Selection */}
          <div className="space-y-2 max-w-[700px]">
            <label className="text-sm font-medium">CSV Format</label>
            <select
              value={selectedBrokerFormat}
              onChange={(e) => {
                const value = Number(e.target.value);
                setSelectedBrokerFormat(value);
                if (value) {
                  setSelectedMapping('');
                }
              }}
              disabled={loadingBrokerFormats || stage === 'validating' || stage === 'importing'}
              className="w-full p-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">-- Auto-detect from account --</option>
              {brokerFormats.map((format) => (
                <option key={format.id} value={format.id}>
                  {format.name}
                </option>
              ))}
            </select>
            {loadingBrokerFormats && (
              <p className="text-xs text-muted-foreground">Loading formats...</p>
            )}
          </div>

          {/* Broker Import Mapping Selection */}
          <div className="space-y-2 max-w-[700px]">
            <label className="text-sm font-medium">Custom Mapping</label>
            <select
              value={selectedMapping}
              onChange={(e) => {
                const value = Number(e.target.value);
                setSelectedMapping(value);
                if (value) {
                  setSelectedBrokerFormat('');
                }
              }}
              disabled={loadingMappings || stage === 'validating' || stage === 'importing'}
              className="w-full p-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">-- Auto-detect from account --</option>
              {mappings.map((mapping) => (
                <option key={mapping.id} value={mapping.id}>
                  {mapping.name}
                </option>
              ))}
            </select>
            {loadingMappings && (
              <p className="text-xs text-muted-foreground">Loading mappings...</p>
            )}
            {selectedAccount && !selectedBrokerFormat && !selectedMapping && (
              <p className="text-xs text-muted-foreground">
                {accounts.find(a => a.id === selectedAccount)?.broker_import_mapping_id
                  ? 'Using account custom mapping'
                  : accounts.find(a => a.id === selectedAccount)?.broker_format_id
                  ? 'Using account default format'
                  : 'Will use Interactive Brokers format'}
              </p>
            )}
          </div>
          </>)}

          {/* Upload Area - Show when in select stage */}
          {stage === 'select' && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                transition-all duration-200
                max-w-[700px]
                ${isDragging 
                  ? 'border-primary bg-primary/5' 
                  : 'border-border hover:border-primary/50 hover:bg-secondary/30'
                }
                ${!selectedAccount ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                disabled={!selectedAccount}
                className="hidden"
              />
              
              <div className="flex flex-col items-center gap-3">
                <Upload className={`h-10 w-10 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <p className="text-sm font-medium">
                    {isDragging ? 'Drop your file here' : 'Drag & drop your CSV file'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    or click to browse
                  </p>
                  {!selectedAccount && (
                    <p className="text-xs text-loss mt-2">Please select an account first</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Validating State */}
          {stage === 'validating' && (
            <div className="border rounded-lg p-8 text-center max-w-[700px]">
              <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto mb-4" />
              <p className="text-sm font-medium">Validating CSV file...</p>
              <p className="text-xs text-muted-foreground mt-1">
                Checking file format and counting executions
              </p>
            </div>
          )}

          {/* Preview/Confirmation Stage */}
          {stage === 'preview' && validationResult && pendingFile && (
            <div className="border rounded-lg p-4 bg-secondary/30 flex flex-col max-h-[70vh] min-w-0">
              {/* File Info */}
              <div className="flex items-start gap-3 mb-3 max-w-[700px] w-full">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <FileUp className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="font-medium text-sm break-all">{pendingFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(pendingFile.size / 1024).toFixed(1)} KB · {validationResult.template_info.detected_format}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCancelUpload}
                  className="shrink-0 h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Summary bar */}
              <div className="mb-3 flex items-center justify-between px-3 py-2 bg-background rounded border max-w-[700px] w-full">
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{selectedRows.size}</span> of{' '}
                  <span className="font-medium text-foreground">{validationResult.total_rows}</span> rows selected
                </div>
                {validationResult.errors.length > 0 && (
                  <div className="text-xs text-amber-500">
                    {validationResult.errors.length} issue{validationResult.errors.length !== 1 ? 's' : ''}
                  </div>
                )}
              </div>

              {/* Advanced matching option */}
              <div className="mb-3 max-w-[700px] w-full">
                <Label className="flex items-center gap-2 text-sm font-normal cursor-pointer">
                  <Checkbox
                    checked={advancedMatching}
                    onCheckedChange={(checked) => {
                      const enabled = checked === true;
                      setAdvancedMatching(enabled);
                      if (enabled) setManualMatching(false);
                    }}
                    disabled={!validationResult.has_timestamps}
                    aria-label="Advanced trade matching using execution timestamps"
                  />
                  Advanced trade matching using execution timestamps
                </Label>
                {!validationResult.has_timestamps && (
                  <p className="text-xs text-muted-foreground mt-1 ml-6">
                    Not available - this file has dates only, no execution times
                  </p>
                )}
                <Label className="mt-2 flex items-center gap-2 text-sm font-normal cursor-pointer">
                  <Checkbox
                    checked={manualMatching}
                    onCheckedChange={(checked) => {
                      const enabled = checked === true;
                      setManualMatching(enabled);
                      if (enabled) setAdvancedMatching(false);
                    }}
                    aria-label="Manual trade matching"
                  />
                  Manual trade matching
                </Label>
                <p className="text-xs text-muted-foreground mt-1 ml-6">
                  Import the executions unmatched, then group them into a new trade or an existing open trade.
                </p>
              </div>

              {/* Row preview table */}
              {validationResult.rows && validationResult.rows.length > 0 ? (
                <div className="mb-3 border rounded bg-background overflow-auto max-h-[50vh]">
                  <table className="text-xs w-max">
                    <thead className="bg-secondary sticky top-0 z-10">
                      <tr>
                        <th className="px-2 py-1.5 text-left w-8 border-b">
                          <input
                            type="checkbox"
                            checked={
                              validationResult.rows.length > 0 &&
                              validationResult.rows.every(r => selectedRows.has(r.index))
                            }
                            onChange={toggleAllRows}
                            className="rounded border-border"
                          />
                        </th>
                        {Object.keys(validationResult.rows[0].data).map(col => (
                          <th key={col} className="px-2 py-1.5 text-left font-medium text-muted-foreground border-b whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {validationResult.rows.map((row) => {
                        const isChecked = selectedRows.has(row.index);
                        return (
                          <tr
                            key={row.index}
                            className={`border-b border-border/50 transition-colors ${
                              isChecked ? 'bg-profit/5' : 'bg-transparent'
                            } hover:bg-secondary/30`}
                          >
                            <td className="px-2 py-1">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleRow(row.index)}
                                className="rounded border-border"
                              />
                            </td>
                            {Object.entries(row.data).map(([col, val]) => (
                              <td
                                key={col}
                                className="px-2 py-1 whitespace-nowrap text-muted-foreground"
                                title={val}
                              >
                                {val}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mb-3 p-4 text-center text-muted-foreground text-sm border rounded bg-background">
                  No rows to preview
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2 shrink-0 max-w-[700px] w-full">
                <Button
                  variant="outline"
                  onClick={handleCancelUpload}
                  className="flex-1"
                  size="sm"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmedUpload}
                  disabled={!validationResult.valid || selectedRows.size === 0}
                  className="flex-1"
                  size="sm"
                >
                  <Upload className="h-3 w-3 mr-2" />
                  Import {selectedRows.size > 0 && `(${selectedRows.size})`}
                </Button>
              </div>
            </div>
          )}

          {stage === 'matching' && result?.executions && selectedAccount && (
            <ManualTradeMatcher
              executions={result.executions}
              accountId={selectedAccount as number}
              onDone={handleClose}
            />
          )}

          {/* Importing State */}
          {stage === 'importing' && (
            <div className="border rounded-lg p-8 text-center max-w-[700px]">
              <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto mb-4" />
              <p className="text-sm font-medium">Importing executions...</p>
              <p className="text-xs text-muted-foreground mt-1">
                This may take a moment for large files
              </p>
            </div>
          )}

          {/* Result Stage */}
          {stage === 'result' && result && (
            <div className={`
              p-4 rounded-lg border max-w-[700px] w-full
              ${result.success 
                ? 'bg-profit/5 border-profit/30' 
                : 'bg-loss/5 border-loss/30'
              }
            `}>
              <div className="flex items-start gap-3">
                {result.success && (!result.errors || result.errors.length === 0) ? (
                  <CheckCircle className="h-5 w-5 text-profit mt-0.5" />
                ) : result.success && result.errors && result.errors.length > 0 ? (
                  <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-loss mt-0.5" />
                )}
                <div className="flex-1">
                  <h4 className={`font-medium ${result.success && (!result.errors || result.errors.length === 0) ? 'text-profit' : result.success ? 'text-amber-500' : 'text-loss'}`}>
                    {result.success && (!result.errors || result.errors.length === 0) ? 'Import Successful' : result.success ? 'Import Partially Successful' : 'Import Failed'}
                  </h4>
                  
                  {result.success && (
                    <div className="mt-2 space-y-1 text-sm">
                      <p>
                        <span className="text-muted-foreground">Executions added:</span>{' '}
                        <span className="font-medium">{result.executions_added}</span>
                      </p>
                      <p>
                        <span className="text-muted-foreground">Total rows:</span>{' '}
                        <span className="font-medium">{result.total_rows}</span>
                      </p>
                      {result.trade_processing && (
                        <div className="mt-2 p-2 bg-background rounded border text-xs space-y-1">
                          <p className="font-medium text-muted-foreground">Trade Processing:</p>
                          <p>
                            <span className="text-muted-foreground">Executions matched:</span>{' '}
                            <span className="font-medium">{result.trade_processing.executions_found}</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground">Trades created:</span>{' '}
                            <span className="font-medium">{result.trade_processing.trades_created}</span>
                          </p>
                          <p>
                            <span className="text-muted-foreground">Trades updated:</span>{' '}
                            <span className="font-medium">{result.trade_processing.trades_updated}</span>
                          </p>
                          {result.trade_processing.errors.length > 0 && (
                            <div className="mt-1">
                              <p className="text-loss font-medium">Warnings:</p>
                              <ul className="space-y-0.5 max-h-24 overflow-y-auto">
                                {result.trade_processing.errors.map((error, index) => (
                                  <li key={index} className="text-loss">• {error}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {!result.success && result.error && (
                    <p className="mt-2 text-sm text-loss">{result.error}</p>
                  )}
                  
                  {result.errors && result.errors.length > 0 && (
                    <div className="mt-3">
                      <p className="text-sm text-muted-foreground mb-1">Errors:</p>
                      <ul className="text-xs space-y-1 max-h-32 overflow-y-auto">
                        {result.errors.map((error, index) => (
                          <li key={index} className="text-loss">• {error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="mt-4 flex justify-end gap-2">
                {result.success ? (
                  <Button onClick={handleClose} className="btn-primary">
                    Done
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={handleClose}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleTryAgain}
                      className="btn-primary"
                    >
                      Try Again
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* CSV Format Info - Show in select stage */}
          {stage === 'select' && (
            <div className="text-xs text-muted-foreground space-y-1 max-w-[700px]">
              <p className="font-medium">Supported Formats:</p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Interactive Brokers</strong> - Standard IB export format</li>
                <li><strong>Tastytrade</strong> - Tastytrade transaction history export</li>
              </ul>
              <p className="mt-2 text-xs">Select the appropriate format above or let it auto-detect from your account settings.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
