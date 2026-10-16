const DAY = 86400000;
const WEEK = 7 * DAY;

// A device cohort, not people or payment conversion. A check-in or saving the
// same session after feedback is not another practice.
export function summarizeFeedbackActivation(rows, { now = Date.now(), excludedDeviceIds = [] } = {}) {
  const excluded = new Set(excludedDeviceIds);
  const devices = new Map();
  let invalidTimeEvents = 0;
  for (const row of rows) {
    if (!row.device_id || excluded.has(row.device_id) || !['ai_feedback_done', 'practice_completed'].includes(row.event)) continue;
    const time = Date.parse(row.occurred_at), received = row.received_at == null ? null : Date.parse(row.received_at);
    if (!Number.isFinite(time) || time > now || (received !== null && (!Number.isFinite(received) || received > now || time > received + 600000))) { invalidTimeEvents++; continue; }
    if (!devices.has(row.device_id)) devices.set(row.device_id, []);
    devices.get(row.device_id).push({ ...row, time });
  }
  let firstFeedbackDevices28d = 0, observed7dDevices = 0, repeated7dDevices = 0;
  const firstFeedbackByField = {};
  for (const events of devices.values()) {
    events.sort((a, b) => a.time - b.time);
    const first = events.find(row => row.event === 'ai_feedback_done');
    if (!first) continue;
    if (first.time >= now - 28 * DAY) {
      firstFeedbackDevices28d++;
      firstFeedbackByField[first.field || 'unknown'] = (firstFeedbackByField[first.field || 'unknown'] || 0) + 1;
    }
    if (!first.session_id || first.time > now - WEEK) continue;
    observed7dDevices++;
    if (events.some(row => row.event === 'practice_completed' && row.kind !== 'checkin' && row.session_id && row.session_id !== first.session_id && row.time > first.time && row.time <= first.time + WEEK)) repeated7dDevices++;
  }
  return { available: true, firstFeedbackDevices28d, firstFeedbackByField,
    afterFirstFeedback7d: { observedDevices: observed7dDevices, repeatedDevices: repeated7dDevices, pct: observed7dDevices ? Math.round(1000 * repeated7dDevices / observed7dDevices) / 10 : null },
    definition: { unit: 'device', cohortBasis: 'first_ai_feedback_in_recorded_history', observationDays: 7, checkinsExcluded: true, distinctSessionsRequired: true, matureCohortsOnly: true, invalidTimeEvents, testDeviceFilterConfigured: excluded.size > 0 } };
}

export async function loadFeedbackActivation(client, options = {}) {
  const now = options.now ?? Date.now();
  const until = new Date(now).toISOString();
  const events = ['ai_feedback_done', 'practice_completed'];
  const { data: last, error: lastError } = await client.from('practice_events').select('id').in('event', events).order('id', { ascending: false }).limit(1);
  if (lastError) throw lastError;
  if (!last?.length) return summarizeFeedbackActivation([], { ...options, now });
  const cursorId = id => {
    if ((typeof id === 'number' && Number.isSafeInteger(id) && id > 0) || (typeof id === 'string' && /^[1-9]\d*$/.test(id))) return String(id);
    throw new Error('invalid feedback event cursor');
  };
  const upper = cursorId(last[0].id), rows = [];
  let cursor = null;
  for (;;) {
    let query = client.from('practice_events').select('id,device_id,event,kind,field,session_id,occurred_at,received_at').in('event', events).lte('id', upper).lte('occurred_at', until).or(`received_at.is.null,received_at.lte.${until}`).order('id', { ascending: true });
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query.limit(1000);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
    const next = cursorId(data[data.length - 1].id);
    if ((cursor && BigInt(next) <= BigInt(cursor)) || BigInt(next) > BigInt(upper)) throw new Error('feedback cursor did not advance');
    cursor = next;
  }
  return summarizeFeedbackActivation(rows, { ...options, now });
}
