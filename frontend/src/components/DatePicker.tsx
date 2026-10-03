import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { formatDate } from '@/lib/utils';

interface DatePickerProps {
  label: string;
  date: string;
  onChange: (date: string) => void;
}

export function DatePicker({ label, date, onChange }: DatePickerProps) {
  const selectedDate = date ? new Date(date) : undefined;

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      onChange(`${year}-${month}-${day}`);
    } else {
      onChange('');
    }
  };

  const handleClear = () => {
    onChange('');
  };

  return (
    <div>
      <label className="text-sm font-medium mb-2 block">{label}</label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-start text-left font-normal"
          >
            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
            {selectedDate ? (
              formatDate(selectedDate)
            ) : (
              <span className="text-muted-foreground">Select date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 bg-background border-border" align="start">
          <div className="p-3 w-[300px] bg-background rounded-md">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleSelect}
              initialFocus
              className="w-full [&_.rdp-table]:w-full [&_.rdp-cell]:w-[40px] [&_.rdp-cell]:h-[40px]"
            />
            {selectedDate && (
              <div className="mt-3 pt-2 border-t border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground hover:text-foreground"
                  onClick={handleClear}
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
