import { enGB } from 'react-day-picker/locale/en-GB';
import { Calendar } from '../../components/ui/calendar';
import { dateToDay, dayToDate } from './model';

export type DayRange = { from: string; to: string };

/**
 * Choosing report dates: a range of Lagos calendar days (WAT), ending no later than today in
 * Lagos. The first day chosen starts the range and the second ends it; a range may also have
 * only a start ("since").
 */
export default function PeriodCalendar({ value, today, onChange, months = 1 }: { value: DayRange; today: string; onChange: (range: DayRange) => void; months?: 1 | 2 }) {
  const shown = value.from || today;
  // With two months, open on the month before so today's month is on the right.
  const opening = months === 2 && !value.from ? `${shiftMonth(today.slice(0, 7), -1)}-01` : `${shown.slice(0, 7)}-01`;
  return (
    <Calendar
      mode="range"
      locale={enGB}
      weekStartsOn={1}
      numberOfMonths={months}
      today={dayToDate(today)}
      defaultMonth={dayToDate(opening)}
      endMonth={dayToDate(today)}
      disabled={{ after: dayToDate(today) }}
      excludeDisabled
      selected={value.from ? { from: dayToDate(value.from), to: value.to ? dayToDate(value.to) : undefined } : undefined}
      onSelect={(range) => onChange({ from: range?.from ? dateToDay(range.from) : '', to: range?.to ? dateToDay(range.to) : '' })}
    />
  );
}

/** "2026-09" moved by some months. */
function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number);
  const moved = new Date(Date.UTC(year!, index! - 1 + by, 1));
  return moved.toISOString().slice(0, 7);
}
