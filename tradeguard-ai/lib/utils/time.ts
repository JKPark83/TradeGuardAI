// UTC and US/Eastern time utilities for futures market context.
// No external deps; uses Intl.DateTimeFormat for DST-correct tz conversion.

/** ISO 8601 string in UTC with trailing `Z`. */
export function toUtcIso(d: Date): string {
  return d.toISOString();
}

/** Current time as a UTC Date. */
export function nowUtc(): Date {
  return new Date();
}

interface EasternParts {
  hour: number;
  minute: number;
  weekday: number; // 0=Sun..6=Sat
}

const ET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour12: false,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function toEasternParts(d: Date): EasternParts {
  const parts = ET_FORMATTER.formatToParts(d);
  let hour = 0;
  let minute = 0;
  let weekday = 0;
  for (const p of parts) {
    if (p.type === 'hour') {
      // Intl may emit "24" for midnight on some runtimes; normalize to 0.
      const h = Number(p.value);
      hour = h === 24 ? 0 : h;
    } else if (p.type === 'minute') {
      minute = Number(p.value);
    } else if (p.type === 'weekday') {
      weekday = WEEKDAY_INDEX[p.value] ?? 0;
    }
  }
  return { hour, minute, weekday };
}

/**
 * True if `d` falls within US/Eastern regular-session equity hours
 * (Mon–Fri, 09:30–16:00 ET). DST-correct via Intl.
 * Note: This is the *equity* RTH window — futures trade nearly 24/5 but
 * macro flow is anchored here.
 */
export function isInUsEasternMarketHours(d: Date): boolean {
  const { hour, minute, weekday } = toEasternParts(d);
  if (weekday < 1 || weekday > 5) return false;
  const minutes = hour * 60 + minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return minutes >= open && minutes < close;
}

/** Extract hour-of-day (0..23) in UTC from an ISO 8601 datetime string. */
export function hourOfDayUtc(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`hourOfDayUtc: invalid ISO datetime: ${iso}`);
  }
  return d.getUTCHours();
}

/** Whole-minute difference (b - a). Negative if b is before a. */
export function minutesBetween(a: Date, b: Date): number {
  return Math.trunc((b.getTime() - a.getTime()) / 60_000);
}
