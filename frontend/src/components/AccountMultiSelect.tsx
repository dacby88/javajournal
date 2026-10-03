import { useMemo, useState } from 'react';
import { ChevronDown, Wallet, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Account } from '@/types';

interface AccountMultiSelectProps {
  accounts: Account[];
  selected: number[];
  onChange: (accountIds: number[]) => void;
  disabled?: boolean;
  /** Render the Wallet icon inside the trigger (desktop header treatment). */
  showIcon?: boolean;
  /** Stretch the trigger to the full width of its container (mobile menu). */
  fullWidth?: boolean;
  className?: string;
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
}

function summarize(accounts: Account[], selected: number[]): string {
  if (selected.length === 0) return 'All Accounts';
  if (selected.length === 1) {
    return accounts.find((a) => a.id === selected[0])?.name ?? '1 account';
  }
  return `${selected.length} accounts`;
}

export function AccountMultiSelect({
  accounts,
  selected,
  onChange,
  disabled = false,
  showIcon = false,
  fullWidth = false,
  className,
  contentClassName,
  align = 'start',
}: AccountMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const visibleAccounts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return accounts;
    return accounts.filter(
      (account) =>
        account.name.toLowerCase().includes(term) ||
        (account.account_number ?? '').toLowerCase().includes(term)
    );
  }, [accounts, search]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggleAccount = (accountId: number) => {
    if (selectedSet.has(accountId)) {
      onChange(selected.filter((id) => id !== accountId));
    } else {
      onChange([...selected, accountId]);
    }
  };

  const selectAll = () => onChange(accounts.map((a) => a.id));
  const clearAll = () => onChange([]);

  const allSelected = accounts.length > 0 && selected.length === accounts.length;
  const label = summarize(accounts, selected);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex items-center gap-2 rounded-lg text-sm font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            showIcon
              ? 'bg-secondary/50 px-3 py-1.5 hover:bg-secondary'
              : 'border border-input bg-background px-3 py-2 hover:bg-accent hover:text-accent-foreground',
            fullWidth ? 'w-full justify-between' : 'min-w-[120px] justify-between',
            className
          )}
        >
          {showIcon && <Wallet className="h-4 w-4 text-muted-foreground" />}
          <span className="truncate">{label}</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180'
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn('w-64 p-0', contentClassName)}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="border-b border-border p-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts..."
            className="h-8"
          />
        </div>

        <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={allSelected ? clearAll : selectAll}
            disabled={accounts.length === 0}
          >
            {allSelected ? 'Clear all' : 'Select all'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {selected.length === 0 ? 'All accounts' : `${selected.length} selected`}
          </span>
        </div>

        <div className="max-h-64 overflow-y-auto p-1">
          {visibleAccounts.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              No accounts found
            </p>
          ) : (
            visibleAccounts.map((account) => {
              const isSelected = selectedSet.has(account.id);
              return (
                <button
                  key={account.id}
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  onClick={() => toggleAccount(account.id)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                    'hover:bg-accent hover:text-accent-foreground',
                    !account.is_active && 'opacity-60'
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    tabIndex={-1}
                    aria-hidden
                    className="pointer-events-none"
                  />
                  <span className="flex-1 truncate">{account.name}</span>
                  {!account.is_active && (
                    <span className="text-[10px] uppercase text-muted-foreground">
                      Inactive
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {selected.length > 0 && (
          <div className="border-t border-border p-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full text-xs"
              onClick={clearAll}
            >
              <X className="mr-1 h-3 w-3" />
              Show all accounts (no filter)
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
