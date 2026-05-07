import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_APP_TIMEZONE = "Asia/Bangkok";

const HAS_EXPLICIT_TIMEZONE_SUFFIX = /(?:[zZ]|[+-]\d{2}:\d{2})$/;

export const combineDateAndTime = (
  dateIso: string,
  time24: string,
  timezone: string = DEFAULT_APP_TIMEZONE,
) => {
  return fromZonedTime(`${dateIso}T${time24}:00`, timezone);
};

export const parseDateTimeInTimeZone = (
  value: string | null | undefined,
  timezone: string = DEFAULT_APP_TIMEZONE,
) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = HAS_EXPLICIT_TIMEZONE_SUFFIX.test(trimmed)
    ? new Date(trimmed)
    : fromZonedTime(trimmed, timezone);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const parseDateTimeToUtcIso = (
  value: string | null | undefined,
  timezone: string = DEFAULT_APP_TIMEZONE,
) => {
  const parsed = parseDateTimeInTimeZone(value, timezone);
  return parsed ? parsed.toISOString() : null;
};

export const formatDateTimeInTimeZone = (
  value: string | Date | null | undefined,
  timezone: string = DEFAULT_APP_TIMEZONE,
  pattern: string = "dd/MM/yyyy HH:mm",
) => {
  if (!value) return "-";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return formatInTimeZone(parsed, timezone, pattern);
};

export const toDateTimeLocalInputValue = (
  value: string | Date | null | undefined,
  timezone: string = DEFAULT_APP_TIMEZONE,
) => {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatInTimeZone(parsed, timezone, "yyyy-MM-dd'T'HH:mm");
};

export const todayInTimeZone = (timezone: string = DEFAULT_APP_TIMEZONE) =>
  formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
