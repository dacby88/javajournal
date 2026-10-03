import { useState, useEffect, useRef, useMemo } from 'react';
import { Check, AlertCircle, Loader2, FileSpreadsheet, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api } from '@/services/api';
import type { BrokerImportMapping, BrokerImportMappingPreview, BrokerFormat } from '@/types';

interface BrokerImportMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  mapping?: BrokerImportMapping | null;
  onSaved: () => void;
}

interface JJField {
  value: string;
  label: string;
  required: boolean;
}

const JJ_FIELDS: JJField[] = [
  { value: 'symbol', label: 'Symbol', required: true },
  { value: 'side', label: 'Side (BUY/SELL)', required: true },
  { value: 'quantity', label: 'Quantity', required: true },
  { value: 'price', label: 'Price', required: true },
  { value: 'trade_date', label: 'Trade Date', required: true },
  { value: 'exec_datetime', label: 'Execution Date/Time', required: false },
  { value: 'commission', label: 'Commission', required: false },
  { value: 'net_cash', label: 'Net Cash', required: false },
  { value: 'underlying_symbol', label: 'Underlying Symbol', required: false },
  { value: 'asset_class', label: 'Asset Class', required: false },
  { value: 'strike', label: 'Strike', required: false },
  { value: 'expiry', label: 'Expiry', required: false },
  { value: 'put_call', label: 'Put/Call', required: false },
  { value: 'multiplier', label: 'Multiplier', required: false },
  { value: 'currency', label: 'Currency', required: false },
  { value: 'description', label: 'Description', required: false },
  { value: 'order_id', label: 'Order ID', required: false },
  { value: 'exec_id', label: 'Execution ID', required: false },
  { value: 'client_account_id', label: 'Account ID', required: false },
  { value: 'account_alias', label: 'Account Alias', required: false },
  { value: 'transaction_type', label: 'Transaction Type', required: false },
  { value: 'exchange', label: 'Exchange', required: false },
];

const REQUIRED_FIELDS = JJ_FIELDS.filter(f => f.required).map(f => f.value);

function buildRowsFromMapping(
  columnMappings: Record<string, string>,
  valueMappings: Record<string, Record<string, string>>
): Array<{ csvHeader: string; jjField: string; valueFormula: string; valueOutput: string }> {
  const rows: Array<{ csvHeader: string; jjField: string; valueFormula: string; valueOutput: string }> = [];

  Object.entries(columnMappings || {})
    .filter(([jjField, csvHeader]) => jjField && csvHeader)
    .forEach(([jjField, csvHeader]) => {
      const fieldValueMappings = valueMappings?.[jjField] || {};
      const valueEntries = Object.entries(fieldValueMappings);
      if (valueEntries.length === 0) {
        rows.push({ csvHeader, jjField, valueFormula: '', valueOutput: '' });
      } else {
        valueEntries.forEach(([formula, output]) => {
          rows.push({ csvHeader, jjField, valueFormula: formula, valueOutput: output });
        });
      }
    });

  return rows;
}

function buildColumnMappingsFromRows(
  rows: Array<{ csvHeader: string; jjField: string; valueFormula: string; valueOutput: string }>
): Record<string, string> {
  const result: Record<string, string> = {};
  rows.forEach(({ csvHeader, jjField }) => {
    if (csvHeader && jjField && jjField !== '__none__') {
      result[jjField] = csvHeader;
    }
  });
  return result;
}

function buildValueMappingsFromRows(
  rows: Array<{ csvHeader: string; jjField: string; valueFormula: string; valueOutput: string }>
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  rows.forEach(({ jjField, valueFormula, valueOutput }) => {
    if (jjField && jjField !== '__none__' && valueFormula.trim() && valueOutput.trim()) {
      if (!result[jjField]) {
        result[jjField] = {};
      }
      result[jjField][valueFormula.trim()] = valueOutput.trim();
    }
  });
  return result;
}

export function BrokerImportMappingModal({
  isOpen,
  onClose,
  mapping,
  onSaved,
}: BrokerImportMappingModalProps) {
  const [name, setName] = useState('');
  const [brokerFormats, setBrokerFormats] = useState<BrokerFormat[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [mappingRows, setMappingRows] = useState<Array<{ csvHeader: string; jjField: string; valueFormula: string; valueOutput: string }>>([]);
  const [parserConfig, setParserConfig] = useState<Record<string, unknown>>({});
  const [preview, setPreview] = useState<BrokerImportMappingPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!mapping;

  useEffect(() => {
    if (isOpen) {
      loadBrokerFormats();
      if (mapping) {
        setName(mapping.name);
        setMappingRows(buildRowsFromMapping(mapping.column_mappings || {}, mapping.value_mappings || {}));
        setParserConfig(mapping.parser_config || {});
        setPreview(null);
        setSelectedTemplateId('');
      } else {
        setName('');
        setMappingRows([]);
        setParserConfig({});
        setPreview(null);
        setSelectedTemplateId('');
      }
      setError(null);
    }
  }, [isOpen, mapping]);

  const loadBrokerFormats = async () => {
    try {
      const response = await api.getBrokerFormats();
      if (response.success) {
        setBrokerFormats(response.data);
      }
    } catch (err) {
      console.error('Failed to load broker formats:', err);
    }
  };

  const handleTemplateChange = async (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId || templateId === 'blank') {
      setMappingRows([]);
      setParserConfig({});
      return;
    }
    const formatId = parseInt(templateId, 10);
    const format = brokerFormats.find(f => f.id === formatId);
    if (!format) return;
    setMappingRows(buildRowsFromMapping(format.column_mappings || {}, format.value_mappings || {}));
    setParserConfig(format.parser_config || {});
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await previewFile(file);
  };

  const previewFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.previewBrokerImportMappingFile(file);
      if (response.success) {
        setPreview(response.data);
        setParserConfig(prev => ({
          ...prev,
          header_row_index: response.data.header_row_index,
        }));
        // Merge suggested mappings and preview headers into mapping rows
        setMappingRows(prev => {
          let rows = [...prev];

          // Apply suggested mappings for jj_fields not already mapped
          Object.entries(response.data.suggested_mappings).forEach(([jjField, csvHeader]) => {
            const alreadyMapped = rows.some(r => r.jjField === jjField);
            if (!alreadyMapped) {
              rows.push({ csvHeader, jjField, valueFormula: '', valueOutput: '' });
            }
          });

          // Ensure every preview header has at least one row
          response.data.headers.forEach(header => {
            const hasRow = rows.some(r => r.csvHeader === header && !r.jjField);
            if (!hasRow) {
              rows.push({ csvHeader: header, jjField: '', valueFormula: '', valueOutput: '' });
            }
          });

          return rows;
        });
      } else {
        setError('Failed to preview file');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview file');
    } finally {
      setLoading(false);
    }
  };

  const handleRowJjFieldChange = (index: number, jjField: string) => {
    setMappingRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], jjField: jjField === '__none__' ? '' : jjField };
      return next;
    });
  };

  const handleRowCsvHeaderChange = (index: number, csvHeader: string) => {
    setMappingRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], csvHeader };
      return next;
    });
  };

  const handleRowValueFormulaChange = (index: number, valueFormula: string) => {
    setMappingRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], valueFormula };
      return next;
    });
  };

  const handleRowValueOutputChange = (index: number, valueOutput: string) => {
    setMappingRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], valueOutput };
      return next;
    });
  };

  const handleAddMappingRow = () => {
    setMappingRows(prev => [...prev, { csvHeader: '', jjField: '', valueFormula: '', valueOutput: '' }]);
  };

  const handleDeleteMappingRow = (index: number) => {
    setMappingRows(prev => prev.filter((_, i) => i !== index));
  };

  const mappedJjFields = useMemo(() => {
    return new Set(mappingRows.map(r => r.jjField).filter(Boolean));
  }, [mappingRows]);

  const mappedRequiredFields = useMemo(() => {
    return REQUIRED_FIELDS.filter(field => mappedJjFields.has(field));
  }, [mappedJjFields]);

  const missingRequiredFields = useMemo(() => {
    return REQUIRED_FIELDS.filter(field => !mappedJjFields.has(field));
  }, [mappedJjFields]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Mapping name is required');
      return;
    }

    const payload = {
      name: name.trim(),
      column_mappings: buildColumnMappingsFromRows(mappingRows),
      value_mappings: buildValueMappingsFromRows(mappingRows),
      parser_config: parserConfig,
    };

    setSaving(true);
    setError(null);
    try {
      if (isEditing && mapping) {
        const response = await api.updateBrokerImportMapping(mapping.id, payload);
        if (response.success) {
          onSaved();
          onClose();
        } else {
          setError('Failed to update mapping');
        }
      } else {
        const response = await api.createBrokerImportMapping(payload);
        if (response.success) {
          onSaved();
          onClose();
        } else {
          setError('Failed to create mapping');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mapping');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="!max-w-[min(80.75vw,1530px)] w-[80.75vw] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="text-xl">
            {isEditing ? 'Edit Broker Import Mapping' : 'New Broker Import Mapping'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <ScrollArea className="flex-1 px-6 py-4">
            <div className="space-y-6">
              {error && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="mapping-name">Mapping Name</Label>
                  <Input
                    id="mapping-name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g., Fidelity Stock Trades"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="template">Base Template (optional)</Label>
                  <Select value={selectedTemplateId} onValueChange={handleTemplateChange}>
                    <SelectTrigger id="template">
                      <SelectValue placeholder="Blank mapping" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="blank">Blank mapping</SelectItem>
                      {brokerFormats.map(format => (
                        <SelectItem key={format.id} value={format.id.toString()}>
                          {format.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Example CSV File</Label>
                <div
                  className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Click to select an example CSV file to map
                  </p>
                  {preview && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Header row detected at row {preview.header_row_index + 1} · {preview.headers.length} columns
                    </p>
                  )}
                </div>
              </div>

              {loading && (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Analyzing CSV...
                </div>
              )}

              {preview && !loading && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="text-sm font-medium">Column Mapping</div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1">
                        <Check className="h-3.5 w-3.5 text-green-600" />
                        Matched
                      </span>
                      <span className="flex items-center gap-1 text-destructive">
                        * Required
                      </span>
                    </div>
                  </div>

                  {missingRequiredFields.length > 0 && (
                    <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded p-2">
                      Missing required mappings:{' '}
                      {missingRequiredFields
                        .map(f => JJ_FIELDS.find(jf => jf.value === f)?.label || f)
                        .join(', ')}
                    </div>
                  )}

                  <div className="border rounded-md overflow-hidden">
                    <div className="grid grid-cols-[160px_1fr_220px_140px_140px_40px] gap-3 bg-muted px-4 py-2 text-xs font-medium text-muted-foreground">
                      <div>CSV Header</div>
                      <div>Sample Data</div>
                      <div>Java Journal Field</div>
                      <div>CSV Value / Formula</div>
                      <div>JJ Value</div>
                      <div />
                    </div>
                    <div className="divide-y">
                      {mappingRows.map((row, index) => {
                        const isMatched = !!row.jjField;
                        const samples = preview.sample_rows[row.csvHeader] || [];
                        return (
                          <div
                            key={`${row.csvHeader}-${index}`}
                            className="grid grid-cols-[160px_1fr_220px_140px_140px_40px] gap-3 px-4 py-3 items-center hover:bg-muted/30"
                          >
                            <Select
                              value={row.csvHeader || '__none__'}
                              onValueChange={value => handleRowCsvHeaderChange(index, value === '__none__' ? '' : value)}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select CSV column" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— Select column —</SelectItem>
                                {preview.headers.map(header => (
                                  <SelectItem key={header} value={header}>
                                    {header}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="flex items-center gap-2 min-w-0">
                              {isMatched && (
                                <Check className="h-4 w-4 text-green-600 shrink-0" />
                              )}
                              <div className="text-xs text-muted-foreground truncate">
                                {samples.slice(0, 3).join(' · ')}
                              </div>
                            </div>
                            <Select
                              value={row.jjField || '__none__'}
                              onValueChange={value => handleRowJjFieldChange(index, value)}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select field" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— Unmapped —</SelectItem>
                                {JJ_FIELDS.map(field => (
                                  <SelectItem key={field.value} value={field.value}>
                                    <span className="flex items-center gap-1">
                                      {field.label}
                                      {field.required && (
                                        <span className="text-destructive">*</span>
                                      )}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              placeholder={row.jjField ? 'e.g., option, >0' : 'select field first'}
                              value={row.valueFormula}
                              onChange={e => handleRowValueFormulaChange(index, e.target.value)}
                              disabled={!row.jjField}
                              className="h-9 text-sm"
                            />
                            <Input
                              placeholder={row.jjField ? 'e.g., OPT' : 'select field first'}
                              value={row.valueOutput}
                              onChange={e => handleRowValueOutputChange(index, e.target.value)}
                              disabled={!row.jjField}
                              className="h-9 text-sm"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteMappingRow(index)}
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-4 py-2 bg-muted/30 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAddMappingRow}
                        className="w-full"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add mapping
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {!preview && !loading && (
                <div className="text-center py-10 text-muted-foreground text-sm border rounded-md bg-muted/20">
                  Select an example CSV file to start mapping columns.
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="px-6 py-4 border-t flex items-center justify-between bg-muted/20">
            <div className="text-xs text-muted-foreground">
              {mappedRequiredFields.length}/{REQUIRED_FIELDS.length} required fields mapped
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleClose} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || mappedRequiredFields.length < REQUIRED_FIELDS.length}
              >
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEditing ? 'Save Changes' : 'Create Mapping'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
