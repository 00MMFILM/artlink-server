// Offline cohort fixtures + a PostgREST-like paged query. No credentials/network.
import assert from "node:assert/strict";
import { summarizePracticeEvents, loadPracticeStats } from "../api/_practiceStats.js";
const now = Date.parse("2026-09-26T12:00:00Z");
function event(device, session, at, patch = {}) {
  return { device_id: device, session_id: session, event: "practice_completed", kind: "video",
    occurred_at: at, received_at: at, ...patch };
}
const rows = [
  event("returns", "a", "2026-09-14T12:00:00Z"),
  event("returns", "b", "2026-09-16T12:00:00Z"),
  event("same-session", "a", "2026-09-14T12:00:00Z"),
  event("same-session", "a", "2026-09-15T12:00:00Z"),
  event("same-day", "a", "2026-09-14T12:00:00Z"),
  event("same-day", "b", "2026-09-14T12:00:30Z"),
  event("too-early", "a", "2026-09-25T12:00:00Z"),
  event("too-early", "b", "2026-09-26T11:00:00Z"),
  event("future", "a", "2026-10-05T12:00:00Z"),
  event("bad-clock", "a", "2026-09-22T12:00:00Z", { received_at: "2026-09-15T12:00:00Z" }),
  event("qa-device", "a", "2026-09-14T12:00:00Z"),
  event("qa-device", "b", "2026-09-15T12:00:00Z"),
];
const result = summarizePracticeEvents(rows, { now, excludedDeviceIds: ["qa-device"] });
assert.deepEqual(result.repeat7dByWeek, [{ cohort_week: "2026-09-14T00:00:00.000Z",
  devices: 3, repeated_7d: 2, returned_later_day_7d: 1, pct: 66.7 }]);
assert.equal(result.last28d.completedDevices, 4);
assert.equal(result.last28d.completedEvents, 8);
assert.equal(result.definition.invalidTimeEvents, 2);
assert.equal(result.definition.testDeviceFilterConfigured, true);
const boundary = summarizePracticeEvents([
  event("exact", "a", "2026-09-19T12:00:00Z"),
  event("exact", "b", "2026-09-26T12:00:00Z"),
  event("late", "a", "2026-09-18T12:00:00Z"),
  event("late", "b", "2026-09-25T12:00:00.001Z"),
], { now });
assert.equal(boundary.repeat7dByWeek[0].devices, 2);
assert.equal(boundary.repeat7dByWeek[0].repeated_7d, 1);
assert.deepEqual(summarizePracticeEvents([], { now }).repeat7dByWeek, []);
assert.equal(summarizePracticeEvents([], { now }).definition.testDeviceFilterConfigured, false);

const many = Array.from({ length: 1005 }, (_, i) => ({
  id: i + 1, ...event(`device-${i}`, `session-${i}`, "2026-09-18T12:00:00Z"),
}));
let fail = false;
function pagedClient(source, beforePage = () => {}) {
  const pages = [];
  const client = { from(table) {
    assert.equal(table, "practice_events");
    let projection, ascending, upperId, afterId = null, until, receivedUntil;
    return {
      select(value) { projection = value; return this; },
      eq(key, value) { assert.equal(key, "event"); assert.equal(value, "practice_completed"); return this; },
      lte(key, value) {
        if (key === "id") upperId = value;
        else { assert.equal(key, "occurred_at"); until = value; }
        return this;
      },
      gt(key, value) { assert.equal(key, "id"); afterId = value; return this; },
      or(value) {
        assert.equal(value, `received_at.is.null,received_at.lte.${new Date(now).toISOString()}`);
        receivedUntil = new Date(now).toISOString();
        return this;
      },
      order(key, options) { assert.equal(key, "id"); ascending = options.ascending; return this; },
      async limit(limit) {
        if (fail) return { error: new Error("synthetic database outage") };
        if (projection !== "id") {
          pages.push({ afterId, upperId, limit });
          beforePage(pages.length);
          assert.equal(until, new Date(now).toISOString());
          assert.equal(receivedUntil, until);
          assert.equal(ascending, true);
        }
        const data = source.filter((row) => row.event === "practice_completed" &&
          (upperId === undefined || BigInt(row.id) <= BigInt(upperId)) &&
          (afterId === null || BigInt(row.id) > BigInt(afterId)) &&
          (!until || Date.parse(row.occurred_at) <= Date.parse(until)) &&
          (!receivedUntil || row.received_at == null || Date.parse(row.received_at) <= Date.parse(receivedUntil)))
          .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0) * (ascending ? 1 : -1))
          .slice(0, limit);
        return { data: projection === "id" ? data.map(({ id }) => ({ id })) : data };
      },
    };
  } };
  return { client, pages };
}
const { client, pages } = pagedClient(many);
const paged = await loadPracticeStats(client, { now });
assert.equal(paged.last28d.completedEvents, 1005);
assert.equal(paged.repeat7dByWeek[0].devices, 1005);
assert.deepEqual(pages, [
  { afterId: null, upperId: "1005", limit: 1000 },
  { afterId: "1000", upperId: "1005", limit: 1000 },
]);

// A backdated offline completion inserted between pages used to shift offsets,
// count a preceding row twice, and omit the new row. New IDs stay outside this
// report, while a received_at cutoff also excludes records after request time.
const concurrentRows = [
  { id: 1, ...event("a", "a", "2026-09-18T10:00:00Z") },
  { id: 2, ...event("b", "b", "2026-09-18T12:00:00Z") },
  { id: 3, ...event("c", "c", "2026-09-18T14:00:00Z") },
  { id: 4, ...event("later-received", "d", "2026-09-18T14:00:00Z", { received_at: "2026-09-26T12:00:01Z" }) },
  { id: 5, ...event("legacy-null", "e", "2026-09-18T15:00:00Z", { received_at: null }) },
];
const concurrent = pagedClient(concurrentRows, (page) => {
  if (page !== 2) return;
  concurrentRows.push(
    { id: 6, ...event("offline-arrival", "f", "2026-09-18T11:00:00Z", { received_at: "2026-09-26T12:00:02Z" }) },
    { id: 7, ...event("new-null", "g", "2026-09-18T11:30:00Z", { received_at: null }) },
  );
});
const snapshot = await loadPracticeStats(concurrent.client, { now, pageSize: 2 });
assert.equal(snapshot.last28d.completedEvents, 4);
assert.equal(snapshot.last28d.completedDevices, 4);
assert.equal(snapshot.repeat7dByWeek[0].devices, 4);
assert.equal(snapshot.repeat7dByWeek[0].repeated_7d, 0);
assert.deepEqual(concurrent.pages.map((page) => page.afterId), [null, "2", "5"]);
assert.equal(concurrent.pages.every((page) => page.upperId === "5"), true);

const empty = await loadPracticeStats(pagedClient([]).client, { now });
assert.equal(empty.last28d.completedEvents, 0);
const largeIds = pagedClient([
  { id: "9007199254740993", ...event("large-a", "a", "2026-09-18T10:00:00Z") },
  { id: "9007199254740994", ...event("large-b", "b", "2026-09-18T11:00:00Z") },
]);
assert.equal((await loadPracticeStats(largeIds.client, { now, pageSize: 1 })).last28d.completedDevices, 2);
assert.equal(largeIds.pages[1].afterId, "9007199254740993");
fail = true;
await assert.rejects(() => loadPracticeStats(client, { now }), /database outage/);
console.log("PASS practice stats: mature cohorts, distinct sessions, later-day return, clock errors, exclusions, boundaries, stable keyset pagination, concurrent offline inserts, legacy null timestamps, BIGINT cursors, outage");
