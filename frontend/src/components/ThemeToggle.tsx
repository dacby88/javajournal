import { Moon, Palette, Building2, Coffee, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Theme = 'java' | 'dark' | 'earth' | 'terminal' | 'tokyo';

interface ThemeToggleProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

const themeIcons: Record<Theme, React.ReactNode> = {
  java: <Coffee className="h-5 w-5" />,
  dark: <Moon className="h-5 w-5" />,
  earth: <Palette className="h-5 w-5" />,
  terminal: <Building2 className="h-5 w-5" />,
  tokyo: <Sparkles className="h-5 w-5" />,
};

export function ThemeToggle({ theme, onThemeChange }: ThemeToggleProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          {themeIcons[theme]}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onThemeChange('java')}>
          <Coffee className="mr-2 h-4 w-4" />
          Java
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onThemeChange('dark')}>
          <Moon className="mr-2 h-4 w-4" />
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onThemeChange('earth')}>
          <Palette className="mr-2 h-4 w-4" />
          Earth Tones
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onThemeChange('terminal')}>
          <Building2 className="mr-2 h-4 w-4" />
          Terminal
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onThemeChange('tokyo')}>
          <Sparkles className="mr-2 h-4 w-4" />
          Tokyo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
