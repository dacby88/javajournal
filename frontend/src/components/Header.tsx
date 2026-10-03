import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, RefreshCw, Coffee, Menu, X, Calendar, Settings, BarChart3, List, LogOut, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImportModal } from './ImportModal';
import { AccountManagementModal } from './AccountManagementModal';
import { AccountMultiSelect } from './AccountMultiSelect';
import { ThemeToggle } from './ThemeToggle';
import { DatePicker } from './DatePicker';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import type { Account } from '@/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export type Theme = 'java' | 'dark' | 'earth' | 'terminal' | 'tokyo';

export type TimePeriod = '1w' | '1m' | '3m' | '6m' | '1y' | 'ytd' | 'all' | 'custom';

interface DateRange {
  startDate: Date;
  endDate: Date;
}

interface HeaderProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onImportSuccess: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  selectedAccounts: number[];
  onAccountsChange: (accountIds: number[]) => void;
  selectedPeriod: TimePeriod;
  onPeriodChange: (period: TimePeriod) => void;
  customDateRange?: DateRange;
  onCustomDateChange?: (range: DateRange) => void;
  dataEndDate?: Date | null;
  onAccountsChanged?: () => void;
}

/** Build a nav URL that carries the dashboard's account selection. */
function buildAccountUrl(path: string, accountIds: number[]): string {
  if (accountIds.length === 0) return path;
  if (accountIds.length === 1) return `${path}?account_id=${accountIds[0]}`;
  return `${path}?account_ids=${accountIds.join(',')}`;
}

const periodLabels: Record<TimePeriod, string> = {
  '1w': '1 Week',
  '1m': '1 Month',
  '3m': '3 Months',
  '6m': '6 Months',
  '1y': '1 Year',
  'ytd': 'YTD',
  'all': 'Since Inception',
  'custom': 'Custom Range',
};

export function Header({ 
  theme,
  onThemeChange,
  onImportSuccess, 
  onRefresh, 
  isRefreshing,
  selectedAccounts,
  onAccountsChange,
  selectedPeriod,
  onPeriodChange,
  customDateRange,
  onCustomDateChange,
  dataEndDate,
  onAccountsChanged,
}: HeaderProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempStartDate, setTempStartDate] = useState('');
  const [tempEndDate, setTempEndDate] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const hasInitializedSelection = useRef(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const response = await api.getAccounts();
      if (response.success) {
        setAccounts(response.data);
        const ids = new Set(response.data.map((a) => a.id));
        // Drop selections for accounts that no longer exist
        const validSelection = selectedAccounts.filter((id) => ids.has(id));
        if (validSelection.length !== selectedAccounts.length) {
          onAccountsChange(validSelection);
        } else if (!hasInitializedSelection.current && validSelection.length === 0 && response.data.length > 0) {
          // On first load with nothing persisted, default to the first active account
          const firstActive = response.data.find(a => a.is_active);
          if (firstActive) {
            onAccountsChange([firstActive.id]);
          }
        }
        hasInitializedSelection.current = true;
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePeriodSelect = (period: TimePeriod) => {
    onPeriodChange(period);
    if (period === 'custom') {
      // Initialize with current dates if not set
      const today = new Date();
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      setTempStartDate(thirtyDaysAgo.toISOString().split('T')[0]);
      setTempEndDate(today.toISOString().split('T')[0]);
      setShowDatePicker(true);
    } else {
      setShowDatePicker(false);
    }
  };

  const handleCustomDateApply = () => {
    if (tempStartDate && tempEndDate && onCustomDateChange) {
      onCustomDateChange({
        startDate: new Date(tempStartDate),
        endDate: new Date(tempEndDate),
      });
      setShowDatePicker(false);
    }
  };

  const formatDateDisplay = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const getDateRangeDisplay = () => {
    if (selectedPeriod === 'custom' && customDateRange) {
      return `${formatDateDisplay(customDateRange.startDate)} - ${formatDateDisplay(customDateRange.endDate)}`;
    }
    if (dataEndDate) {
      return `Through ${formatDateDisplay(dataEndDate)}`;
    }
    return '';
  };

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                <Coffee className="h-5 w-5 text-primary" />
              </div>
              <span className="text-lg font-semibold hidden sm:block">Java Journal</span>
            </div>

            {/* Selectors */}
            <div className="hidden md:flex items-center gap-2">
              {/* Account Multi-Select */}
              <AccountMultiSelect
                accounts={accounts}
                selected={selectedAccounts}
                onChange={onAccountsChange}
                disabled={loading}
                showIcon
              />

              {/* Time Period Selector */}
              <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-1.5 relative">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={selectedPeriod}
                  onValueChange={(value) => handlePeriodSelect(value as TimePeriod)}
                >
                  <SelectTrigger size="sm" className="border-0 shadow-none px-0 min-w-[100px] text-sm font-medium gap-1 focus-visible:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(periodLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {/* Date Range Display */}
                {getDateRangeDisplay() && (
                  <span className="text-xs text-muted-foreground border-l border-border pl-2 ml-1">
                    {getDateRangeDisplay()}
                  </span>
                )}

                {/* Custom Date Picker Popup */}
                {showDatePicker && selectedPeriod === 'custom' && (
                  <div className="absolute top-full right-0 mt-2 p-4 bg-card border border-border rounded-lg shadow-xl z-50 w-[320px]">
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium">Select Date Range</h4>
                      <DatePicker
                        label="Start Date"
                        date={tempStartDate}
                        onChange={(date: string) => setTempStartDate(date)}
                      />
                      <DatePicker
                        label="End Date"
                        date={tempEndDate}
                        onChange={(date: string) => setTempEndDate(date)}
                      />
                      <div className="flex justify-end gap-2 pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowDatePicker(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleCustomDateApply}
                          disabled={!tempStartDate || !tempEndDate}
                          className="btn-primary"
                        >
                          Apply
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Desktop Actions */}
            <div className="hidden md:flex items-center gap-3">
              <ThemeToggle theme={theme} onThemeChange={onThemeChange} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(buildAccountUrl('/trades', selectedAccounts))}
                className="flex items-center gap-2"
              >
                <BarChart3 className="h-4 w-4" />
                Trades
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(buildAccountUrl('/executions', selectedAccounts))}
                className="flex items-center gap-2"
              >
                <List className="h-4 w-4" />
                Executions
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'spinner' : ''}`} />
                Refresh
              </Button>
              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-2 ml-2"
                  >
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {user?.username?.charAt(0).toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden lg:inline max-w-[100px] truncate">
                      {user?.username || 'User'}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user?.username || 'User'}</p>
                      <p className="text-xs leading-none text-muted-foreground">
                        Logged in
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setIsAccountModalOpen(true)}>
                    <Settings className="mr-2 h-4 w-4" />
                    Manage Accounts
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsImportOpen(true)}>
                    <Upload className="mr-2 h-4 w-4" />
                    Import CSV
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/settings')}>
                    <Settings className="mr-2 h-4 w-4" />
                    Tag Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/change-password')}>
                    <Lock className="mr-2 h-4 w-4" />
                    Change Password
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={async () => {
                      setIsLoggingOut(true);
                      try {
                        await logout();
                      } finally {
                        setIsLoggingOut(false);
                      }
                    }}
                    disabled={isLoggingOut}
                    className="text-destructive focus:text-destructive"
                  >
                    {isLoggingOut ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogOut className="mr-2 h-4 w-4" />
                    )}
                    {isLoggingOut ? 'Logging out...' : 'Logout'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </button>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-border space-y-3">
              {/* Mobile Selectors */}
              <div className="px-2 space-y-2">
                <AccountMultiSelect
                  accounts={accounts}
                  selected={selectedAccounts}
                  onChange={onAccountsChange}
                  disabled={loading}
                  fullWidth
                />
                <Select
                  value={selectedPeriod}
                  onValueChange={(value) => {
                    handlePeriodSelect(value as TimePeriod);
                    if (value !== 'custom') {
                      setMobileMenuOpen(false);
                    }
                  }}
                >
                  <SelectTrigger className="w-full bg-secondary/50 border-0 shadow-none rounded-lg px-3 py-2 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(periodLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {/* Mobile Custom Date Picker */}
                {selectedPeriod === 'custom' && (
                  <div className="space-y-2 p-3 bg-secondary/30 rounded-lg">
                    <input
                      type="date"
                      value={tempStartDate}
                      onChange={(e) => setTempStartDate(e.target.value)}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                      placeholder="Start Date"
                    />
                    <input
                      type="date"
                      value={tempEndDate}
                      onChange={(e) => setTempEndDate(e.target.value)}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                      placeholder="End Date"
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        handleCustomDateApply();
                        setMobileMenuOpen(false);
                      }}
                      disabled={!tempStartDate || !tempEndDate}
                      className="w-full btn-primary"
                    >
                      Apply Range
                    </Button>
                  </div>
                )}
                
                {/* Mobile Date Display */}
                {getDateRangeDisplay() && (
                  <div className="text-xs text-muted-foreground text-center py-1">
                    {getDateRangeDisplay()}
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigate('/trades');
                  setMobileMenuOpen(false);
                }}
                className="w-full flex items-center justify-center gap-2"
              >
                <BarChart3 className="h-4 w-4" />
                Trades
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigate('/executions');
                  setMobileMenuOpen(false);
                }}
                className="w-full flex items-center justify-center gap-2"
              >
                <List className="h-4 w-4" />
                Executions
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onRefresh();
                  setMobileMenuOpen(false);
                }}
                disabled={isRefreshing}
                className="w-full flex items-center justify-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'spinner' : ''}`} />
                Refresh
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setIsImportOpen(true);
                  setMobileMenuOpen(false);
                }}
                className="w-full flex items-center justify-center gap-2 btn-primary"
              >
                <Upload className="h-4 w-4" />
                Import CSV
              </Button>
            </div>
          )}
        </div>
      </header>

      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={() => {
          setIsImportOpen(false);
          onImportSuccess();
        }}
        defaultAccountId={selectedAccounts[0] ?? undefined}
      />

      <AccountManagementModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        onAccountsChanged={() => {
          loadAccounts();
          onImportSuccess(); // Refresh dashboard data
          onAccountsChanged?.(); // Notify parent to refresh accounts
        }}
      />
    </>
  );
}
