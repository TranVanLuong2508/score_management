'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { DayOfWeek, getDayNames, getMonthDays, getMonthName, isSameDay, isSameMonth, isToday, isWeekend, startOfMonth, today } from './calendar-utils';

export type { DayOfWeek } from './calendar-utils';

export interface CalendarProps {
  selected?: Date | undefined;
  onSelect?: (date: Date | undefined) => void;
  initialMonth?: Date;
  minDate?: Date;
  maxDate?: Date;
  className?: string;
  disablePast?: boolean;
}

export function Calendar({
  selected,
  onSelect,
  initialMonth,
  minDate,
  maxDate,
  className,
  disablePast,
}: CalendarProps) {
  const [month, setMonth] = React.useState(initialMonth ?? today());

  const dayNames = getDayNames('short');
  const weeks = getMonthDays(month);

  const isDisabled = (date: Date) => {
    if (disablePast && date < today()) return true;
    if (minDate && date < minDate) return true;
    if (maxDate && date > maxDate) return true;
    return false;
  };

  return (
    <div className={cn('p-3 select-none', className)}>
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setMonth((m) => {
            const d = new Date(m);
            d.setMonth(d.getMonth() - 1);
            return d;
          })}
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">
          {getMonthName(month, 'long')} {month.getFullYear()}
        </span>
        <button
          type="button"
          onClick={() => setMonth((m) => {
            const d = new Date(m);
            d.setMonth(d.getMonth() + 1);
            return d;
          })}
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {dayNames.map((name) => (
          <div
            key={name}
            className="h-8 flex items-center justify-center text-xs font-medium text-muted-foreground"
          >
            {name}
          </div>
        ))}
      </div>

      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((date, di) => {
            if (!date) {
              return <div key={di} />;
            }
            const disabled = isDisabled(date);
            const selectedDay = !!selected && isSameDay(date, selected);
            const currentMonth = isSameMonth(date, month);
            const weekend = isWeekend(date);

            return (
              <button
                key={di}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && onSelect?.(date)}
                className={cn(
                  'h-8 w-full text-xs rounded-md flex items-center justify-center transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  'disabled:pointer-events-none disabled:opacity-30',
                  selectedDay && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                  !selectedDay && isToday(date) && 'bg-accent text-accent-foreground font-semibold ring-1 ring-primary/50',
                  !selectedDay && !isToday(date) && weekend && 'text-muted-foreground',
                  !currentMonth && 'text-muted-foreground/50',
                )}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
