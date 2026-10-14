const minuteMs = 60_000;

export function addBusinessMinutes(
  startValue: Date | string,
  minutes: number,
  timezone: string,
): Date {
  const start = new Date(startValue);
  if (Number.isNaN(start.getTime()) || !Number.isInteger(minutes) || minutes < 0)
    throw new RangeError('A valid start time and non-negative whole-minute duration are required.');
  if (minutes === 0) return start;

  let cursor = new Date(Math.ceil(start.getTime() / minuteMs) * minuteMs);
  let remaining = minutes;
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: timezone,
    weekday: 'short',
  });
  let checked = 0;
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + minuteMs);
    const parts = formatter.formatToParts(new Date(cursor.getTime() - 1_000));
    const weekday = parts.find((part) => part.type === 'weekday')?.value;
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    if (weekday !== 'Sat' && weekday !== 'Sun' && Number.isInteger(hour) && hour >= 9 && hour < 17)
      remaining -= 1;
    checked += 1;
    if (checked > 31 * 24 * 60)
      throw new RangeError('The business-minute deadline exceeds the supported 31-day window.');
  }
  return cursor;
}

export function businessTimerState(input: {
  completedAt: Date | string | null;
  createdAt: Date | string;
  dueAt: Date | string;
  minutes: number;
  now: Date;
  thresholdPercent: number;
  timezone: string;
}): 'at_risk' | 'breached' | 'met' | 'on_track' {
  const dueAt = new Date(input.dueAt);
  if (input.completedAt) return new Date(input.completedAt) <= dueAt ? 'met' : 'breached';
  if (input.now > dueAt) return 'breached';
  const riskMinutes = Math.max(1, Math.floor((input.minutes * input.thresholdPercent) / 100));
  const riskAt = addBusinessMinutes(input.createdAt, riskMinutes, input.timezone);
  return input.now >= riskAt ? 'at_risk' : 'on_track';
}
