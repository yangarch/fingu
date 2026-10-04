// Subset of intervals.icu API responses that fingu reads. Fields are optional
// because intervals.icu omits them per activity (no HR strap, manual entry...).

export interface IntervalsActivity {
  id: string; // "i123456789"
  name?: string;
  type?: string; // "Swim", "OpenWaterSwim", "Ride", ...
  description?: string | null;
  start_date_local?: string; // "2026-10-01T07:12:00" (no zone)
  distance?: number; // metres
  moving_time?: number; // seconds
  elapsed_time?: number;
  average_speed?: number; // m/s
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  source?: string; // "GARMIN_CONNECT", "STRAVA", "UPLOAD", ...
  icu_intervals?: IntervalsInterval[];
}

export interface IntervalsInterval {
  type?: string; // "WORK" | "RECOVERY"
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
}

export interface IntervalsStream {
  type: string;
  data: (number | null)[];
}
