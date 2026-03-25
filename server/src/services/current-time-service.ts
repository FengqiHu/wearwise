export interface CurrentTimeToolResult {
  ok: boolean;
  error?: string;
  datetime?: {
    iso: string;
    date: string;
    time: string;
    timezone: string;
    utcOffset: string;
  };
}

export class CurrentTimeService {
  executeTool(rawArguments: string): CurrentTimeToolResult {
    let timezone: string | undefined;

    try {
      const args = JSON.parse(rawArguments) as { timezone?: string };
      timezone = args.timezone?.trim() || undefined;
    } catch {
      return { ok: false, error: "Invalid get_current_time tool arguments." };
    }

    const resolvedTimezone = timezone ?? "UTC";

    try {
      const now = new Date();

      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: resolvedTimezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).formatToParts(now);

      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      const date = `${get("year")}-${get("month")}-${get("day")}`;
      const time = `${get("hour")}:${get("minute")}:${get("second")}`;

      const utcOffsetMatch = new Intl.DateTimeFormat("en-US", {
        timeZone: resolvedTimezone,
        timeZoneName: "longOffset"
      })
        .format(now)
        .match(/GMT[+-]\d{2}:\d{2}/);
      const utcOffset = utcOffsetMatch ? utcOffsetMatch[0] : "GMT+00:00";

      return {
        ok: true,
        datetime: {
          iso: `${date}T${time}`,
          date,
          time,
          timezone: resolvedTimezone,
          utcOffset
        }
      };
    } catch {
      return {
        ok: false,
        error: timezone
          ? `Unknown or invalid timezone "${timezone}". Use an IANA timezone name like "America/New_York".`
          : "Failed to retrieve the current time."
      };
    }
  }
}
