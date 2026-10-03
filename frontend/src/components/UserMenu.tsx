import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronDown, Lock, LogOut, RefreshCw, Settings, Upload } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface UserMenuProps {
  onManageAccounts: () => void;
  onImportCSV: () => void;
  onMenuAction?: () => void;
  mobile?: boolean;
}

export function UserMenu({ onManageAccounts, onImportCSV, onMenuAction, mobile = false }: UserMenuProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const username = user?.username || 'User';
  const select = (action: () => void) => {
    onMenuAction?.();
    action();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={mobile ? 'outline' : 'ghost'} size="sm" className={mobile ? 'flex w-full items-center justify-between gap-2' : 'ml-2 flex items-center gap-2'} aria-label={`User menu for ${username}`}>
          <Avatar className="h-6 w-6">
            <AvatarFallback className="bg-primary/10 text-xs text-primary">{username.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className={`${mobile ? 'max-w-[150px] flex-1 text-left' : 'hidden max-w-[100px] lg:inline'} truncate`}>{username}</span>
          {mobile && <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{username}</p>
            <p className="text-xs leading-none text-muted-foreground">Logged in</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => select(() => navigate('/help'))}>
          <BookOpen className="mr-2 h-4 w-4" /> User Help Guide
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => select(onManageAccounts)}>
          <Settings className="mr-2 h-4 w-4" /> Manage Accounts
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => select(onImportCSV)}>
          <Upload className="mr-2 h-4 w-4" /> Import CSV
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => select(() => navigate('/settings'))}>
          <Settings className="mr-2 h-4 w-4" /> Tag Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => select(() => navigate('/change-password'))}>
          <Lock className="mr-2 h-4 w-4" /> Change Password
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            onMenuAction?.();
            setIsLoggingOut(true);
            try { await logout(); } finally { setIsLoggingOut(false); }
          }}
          disabled={isLoggingOut}
          className="text-destructive focus:text-destructive"
        >
          {isLoggingOut ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
          {isLoggingOut ? 'Logging out...' : 'Logout'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
