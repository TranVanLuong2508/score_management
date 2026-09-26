'use client';

import * as React from 'react';
import { Calendar, type CalendarProps } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Button } from './button';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { CalendarDays } from 'lucide-react';
import { VIETNAM_TZ } from '@/utils/formateDate';

interface DatePickerProps {
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  placeholder?: string;
  minDate?: Date;
  maxDate?: Date;
  disablePast?: boolean;
  error?: string;
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  label,
  placeholder = 'Chọn ngày',
  minDate,
  maxDate,
  disablePast,
  error,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [tempDate, setTempDate] = React.useState<Date | undefined>(
    value ? new Date(value) : undefined
  );

  const displayValue = value
    ? (() => {
        const d = new Date(value);
        return isNaN(d.getTime()) ? '' : formatInTimeZone(d, VIETNAM_TZ, 'dd/MM/yyyy');
      })()
    : '';

  const handleSelect: CalendarProps['onSelect'] = (date) => {
    if (!date) return;
    setTempDate(date);
    const isoString = format(date, 'yyyy-MM-dd');
    onChange?.(isoString);
    setOpen(false);
  };

  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <label className="text-xs font-semibold uppercase text-muted-foreground">
          {label}
        </label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className={cn(
              'w-full justify-start text-left font-normal h-9 px-3',
              !value && 'text-muted-foreground',
              error && 'border-destructive ring-1 ring-destructive',
            )}
          >
            <CalendarDays className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            {displayValue || <span className="text-muted-foreground">{placeholder}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            selected={tempDate}
            onSelect={handleSelect}
            initialMonth={tempDate}
            minDate={minDate}
            maxDate={maxDate}
            disablePast={disablePast}
          />
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
