// Device cohorts, not people or paying customers. Keep the observation window
// fixed for the whole request so paging cannot change which cohorts are mature.
const DAY = 86400000;
const WEEK = 7 * DAY;
const CLOCK_TOLERANCE = 10 * 60000;

function weekStart(time) {
  const day = new Date(time);
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString();
}

function kstDay(time) {
  return new Date(time + 9 * 3600000).toISOString().slice(0, 10);
}

export function summarizePracticeEvents(rows, { now = Date.now(), excludedDeviceIds = [] } = {}) {
  const excluded = new Set(excludedDeviceIds);
  const byDevice = new Map();
  const recentDevices = new Set();
  const byKind = {};
  let completedEvents = 0, invalidTimeEvents = 0;
  for (const row of rows) {
    if (row.event !== "practice_completed" || !row.device_id || excluded.has(row.device_id)) continue;
    const time = Date.parse(row.occurred_at);
    const received = row.received_at ? Date.parse(row.received_at) : null;
    // A historical clock error must not become valid merely because its future
    // date eventually arrives. Preserve the source rows; exclude from reports.
    if (!Number.isFinite(time) || time > now ||
        (received !== null && (!Number.isFinite(received) || time > received + CLOCK_TOLERANCE))) {
      invalidTimeEvents++;
      continue;
    }
    if (time >= now - 28 * DAY) {
      completedEvents++;
      recentDevices.add(row.device_id);
      byKind[row.kind] = (byKind[row.kind] || 0) + 1;
    }
    if (!row.session_id) continue;
    if (!byDevice.has(row.device_id)) byDevice.set(row.device_id, []);
    byDevice.get(row.device_id).push({ ...row, time });
  }
  const cohorts = new Map();
  for (const events of byDevice.values()) {
    events.sort((a, b) => a.time - b.time || String(a.session_id).localeCompare(String(b.session_id)));
    const first = events[0];
    if (first.time > now - WEEK) continue; // Everyone has had a full seven days.
    const key = weekStart(first.time);
    if (!cohorts.has(key)) cohorts.set(key, {
      cohort_week: key, devices: 0, repeated_7d: 0, returned_later_day_7d: 0,
    });
    const cohort = cohorts.get(key);
    const repeats = events.filter((event) => event.session_id !== first.session_id &&
      event.time > first.time && event.time <= first.time + WEEK);
    cohort.devices++;
    if (repeats.length) cohort.repeated_7d++;
    if (repeats.some((event) => kstDay(event.time) !== kstDay(first.time))) cohort.returned_later_day_7d++;
  }
  return {
    available: true,
    repeat7dByWeek: [...cohorts.values()].sort((a, b) => a.cohort_week.localeCompare(b.cohort_week))
      .map((cohort) => ({ ...cohort, pct: Math.round(1000 * cohort.repeated_7d / cohort.devices) / 10 })),
    last28d: { completedDevices: recentDevices.size, completedEvents, byKind },
    definition: {
      version: "2026-09-26.1", unit: "device", observationDays: 7,
      matureCohortsOnly: true, distinctSessionsRequired: true,
      cohortTimezone: "UTC", returnDayTimezone: "Asia/Seoul",
      excludedDeviceCount: excluded.size, invalidTimeEvents,
      testDeviceFilterConfigured: excluded.size > 0,
    },
  };
}

export async function loadPracticeStats(client, { now = Date.now(), excludedDeviceIds = [], pageSize = 1000 } = {}) {
  const rows = [];
  const until = new Date(now).toISOString();
  const limit = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 1000) : 1000;
  // id is BIGSERIAL. Freeze its upper bound before reading any pages so an
  // offline event arriving mid-request cannot shift an offset or join the scan.
  // This also bounds old rows whose received_at is null.
  const { data: latest, error: latestError } = await client.from("practice_events")
    .select("id").eq("event", "practice_completed")
    .order("id", { ascending: false }).limit(1);
  if (latestError) throw latestError;
  if (!latest?.length) return summarizePracticeEvents(rows, { now, excludedDeviceIds });
  const idCursor = (id) => {
    // Never silently round a BIGINT cursor supplied as an unsafe JSON number.
    if ((typeof id === "number" && Number.isSafeInteger(id) && id > 0) ||
        (typeof id === "string" && /^[1-9]\d*$/.test(id))) return String(id);
    throw new Error("practice stats: invalid or unsafe event id");
  };
  const upperId = idCursor(latest[0].id);
  let cursor = null;
  for (;;) {
    let query = client.from("practice_events")
      .select("id, device_id, event, kind, session_id, occurred_at, received_at")
      .eq("event", "practice_completed").lte("occurred_at", until).lte("id", upperId)
      .or(`received_at.is.null,received_at.lte.${until}`)
      .order("id", { ascending: true });
    if (cursor !== null) query = query.gt("id", cursor);
    const { data, error } = await query.limit(limit);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < limit) break;
    const next = idCursor(data[data.length - 1].id);
    if ((cursor !== null && BigInt(next) <= BigInt(cursor)) || BigInt(next) > BigInt(upperId)) {
      throw new Error("practice stats: event cursor did not advance within the snapshot");
    }
    cursor = next;
  }
  return summarizePracticeEvents(rows, { now, excludedDeviceIds });
}
