import { formatInTimeZone, toDate } from "date-fns-tz";

export const combineDateAndTime = (
  dateIso: string,
  time24: string,
  timezone: string,
) => {
  const normalizedDate = toDate(`${dateIso}T00:00:00`);
  const [hours, minutes] = time24.split(":").map(Number);

  const utcDate = new Date(
    Date.UTC(
      normalizedDate.getUTCFullYear(),
      normalizedDate.getUTCMonth(),
      normalizedDate.getUTCDate(),
      Number.isFinite(hours) ? hours : 0,
      Number.isFinite(minutes) ? minutes : 0,
      0,
      0,
    ),
  );

  const zoned = formatInTimeZone(utcDate, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");
  return new Date(zoned);
};

export const todayInTimeZone = (timezone: string) =>
  formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
