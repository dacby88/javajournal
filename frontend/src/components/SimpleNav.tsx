import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';

interface SimpleNavProps {
  title: string | ReactNode;
  showBack?: boolean;
}

export function SimpleNav({ title, showBack = true }: SimpleNavProps) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            {showBack && (
              <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <span className="text-lg font-semibold">{title}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/')}>
              Dashboard
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/trades')}>
              Trades
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/executions')}>
              Executions
            </Button>
            <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} title="Settings">
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
