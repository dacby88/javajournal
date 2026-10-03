import { Calendar as CalendarIcon, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { parseISO } from 'date-fns';
import { formatDateTime, formatTime } from '@/lib/utils';
import { Input } from '@/components/ui/input';

interface DateTimePickerProps {
  label: string;
  datetime: string;
  onChange: (datetime: string) => void;
  defaultTime?: string;
}

export function DateTimePicker({ label, datetime, onChange, defaultTime = '00:00' }: DateTimePickerProps) {
  const selectedDate = datetime ? parseISO(datetime) : undefined;
  const selectedTime = selectedDate 
    ? formatTime(selectedDate)
    : defaultTime;

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      const currentTime = selectedDate || new Date();
      date.setHours(currentTime.getHours());
      date.setMinutes(currentTime.getMinutes());
      onChange(date.toISOString());
    } else {
      onChange('');
    }
  };

  const handleTimeChange = (timeStr: string) => {
    const baseDate = selectedDate || new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    baseDate.setHours(hours);
    baseDate.setMinutes(minutes);
    onChange(baseDate.toISOString());
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
              <span>{formatDateTime(selectedDate)}</span>
            ) : (
              <span className="text-muted-foreground">Select date & time</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 bg-background border-border" align="start">
          <div className="p-3 w-[320px] bg-background rounded-md">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              initialFocus
              className="w-full [&_.rdp-table]:w-full [&_.rdp-cell]:w-[40px] [&_.rdp-cell]:h-[40px]"
            />
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Time</span>
                <Input
                  type="time"
                  value={selectedTime}
                  onChange={(e) => handleTimeChange(e.target.value)}
                  className="flex-1"
                />
              </div>
              {selectedDate && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground hover:text-foreground"
                  onClick={handleClear}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
