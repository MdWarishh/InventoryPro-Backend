// ─── IST-safe date helpers ─────────────────────────────────
// Problem this fixes: your server likely runs in UTC. Using
// setUTCHours(0,0,0,0) makes the "day" flip at 5:30 AM IST instead
// of midnight IST — so a 1 AM check-in gets logged under the wrong date,
// and monthly reports can be off by a day at the edges.
//
// Fix: shift the clock by IST offset (+5:30) BEFORE finding midnight,
// then shift back. Everything is still stored as a real UTC Date
// in Postgres — this only changes WHICH day we consider it to be.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

// Current time (still a real Date/UTC instant, just for convenience)
export const nowUTC = () => new Date()

// Returns a Date representing "midnight IST" of the given date's IST calendar day.
// Store this in the `date` column of Attendance.
export const toDateOnlyIST = (d = new Date()) => {
  const shifted = new Date(new Date(d).getTime() + IST_OFFSET_MS)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - IST_OFFSET_MS)
}

export const hoursBetween = (start, end) =>
  Math.round(((end - start) / 3_600_000) * 100) / 100

// "09:15" -> 555 (minutes since midnight)
export const timeStrToMinutes = (t) => {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Given a real Date (e.g. checkInTime), return minutes-since-midnight IN IST.
// Used to compare actual check-in time against a shift's expected "checkInTime".
export const getISTMinutesOfDay = (date) => {
  const ist = new Date(date.getTime() + IST_OFFSET_MS)
  return ist.getUTCHours() * 60 + ist.getUTCMinutes()
}

// Month range helper (IST-safe) — returns [from, to] as Date-only-IST values
export const monthRangeIST = (year, month /* 1-12 */) => {
  const from = toDateOnlyIST(new Date(Date.UTC(year, month - 1, 1)))
  const to = toDateOnlyIST(new Date(Date.UTC(year, month, 0))) // last day of month
  return { from, to }
}