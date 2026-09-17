/* ═══════════════════════════════════════════════════════════════
   GabikOS — iCalendar (.ics) reader

   Written for school exports (ŠkolaOnline, Bakaláři, Google
   Calendar). Deliberately lenient: real-world school feeds bend the
   spec, and half a timetable you can fix by hand beats a parse error.
   ═══════════════════════════════════════════════════════════════ */

/** RFC 5545 line folding: a leading space or tab continues the line above. */
function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

/** "DTSTART;TZID=Europe/Prague:20260915T080000" → {name, params, value} */
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(';');
  const params = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

/** Escaped text values: \, \; \n literal sequences. */
const unescapeText = v => String(v)
  .replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\\\/g, '\\');

/**
 * Date-time. A trailing Z is UTC and gets converted to local time;
 * anything else (floating, or carrying a TZID) is read as wall-clock
 * time, which is what a school feed means and what the pupil reads.
 */
function parseDate(value, params) {
  const v = String(value).trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh = '0', mm = '0', ss = '0', z] = m;
  const allDay = !v.includes('T');
  const date = z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss))
    : new Date(+y, +mo - 1, +d, +hh, +mm, +ss);
  return { date, allDay };
}

/** Every VEVENT in the file, as plain objects. */
export function parseICS(text) {
  const lines = unfold(text).split('\n');
  const events = [];
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = { raw: {} }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;

    const p = parseLine(line);
    if (!p) continue;
    cur.raw[p.name] = p.value;

    switch (p.name) {
      case 'SUMMARY':     cur.title = unescapeText(p.value); break;
      case 'LOCATION':    cur.location = unescapeText(p.value); break;
      case 'DESCRIPTION': cur.description = unescapeText(p.value); break;
      case 'UID':         cur.uid = p.value; break;
      case 'RRULE':       cur.rrule = p.value; break;
      case 'DTSTART': { const d = parseDate(p.value, p.params); if (d) { cur.start = d.date; cur.allDay = d.allDay; } break; }
      case 'DTEND':   { const d = parseDate(p.value, p.params); if (d) cur.end = d.date; break; }
    }
  }
  return events.filter(e => e.start && e.title);
}

const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Collapse a feed into one representative week.
 *
 * A school export is usually many weeks of concrete dates rather than
 * repeating rules, so the same lesson appears over and over. Group by
 * weekday + start time + title, keep one of each, and count how often
 * it occurred — a lesson seen in most weeks is a regular fixture, one
 * seen once is probably a one-off that should not enter the timetable.
 */
export function toWeeklySlots(events, { minOccurrences = 1 } = {}) {
  const byKey = new Map();

  for (const e of events) {
    if (e.allDay) continue;                       // holidays, not lessons
    const day = e.start.getDay();                 // 0 Sun … 6 Sat
    const start = hhmm(e.start);
    const end = e.end ? hhmm(e.end) : '';
    const title = e.title.trim();
    const key = `${day}|${start}|${title.toLowerCase()}`;

    if (!byKey.has(key)) {
      byKey.set(key, {
        day, start, end, title,
        room: (e.location || '').trim(),
        teacher: teacherFrom(e),
        short: shortFrom(e),
        count: 0,
        dates: [],
      });
    }
    const slot = byKey.get(key);
    slot.count++;
    slot.dates.push(e.start);
    if (!slot.room && e.location) slot.room = e.location.trim();
    if (!slot.teacher) slot.teacher = teacherFrom(e);
    if (!slot.short) slot.short = shortFrom(e);
  }

  const slots = [...byKey.values()].filter(s => s.count >= minOccurrences);

  // a lesson in roughly half the weeks is an alternating-week lesson
  const max = Math.max(1, ...slots.map(s => s.count));
  for (const s of slots) {
    s.everyWeek = s.count >= max * 0.75;
    s.weekParity = s.everyWeek ? 'all' : isoWeek(s.dates[0]) % 2 ? 'a' : 'b';
  }
  return slots.sort((a, b) => (a.day - b.day) || a.start.localeCompare(b.start));
}

/** Some exports print the subject's own abbreviation; prefer it over a guess. */
function shortFrom(e) {
  const d = (e.description || '').trim();
  const m = d.match(/(?:zkratka|zkr|short|code|k[óo]d)\s*[:\-]\s*([^\n;]+)/i);
  return m ? m[1].trim().slice(0, 8) : '';
}

/** Teachers hide in different fields depending on the system. */
function teacherFrom(e) {
  const d = (e.description || '').trim();
  if (!d) return '';
  const labelled = d.match(/(?:u[čc]itel|teacher|vyu[čc]uj[íi]c[íi]|lektor)\s*[:\-]\s*([^\n;]+)/i);
  if (labelled) return labelled[1].trim();
  const first = d.split('\n')[0].trim();
  return first.length <= 40 ? first : '';
}

/** ISO-8601 week number — Czech timetables alternate on this. */
export function isoWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = (d.getDay() + 6) % 7;            // Monday = 0
  d.setDate(d.getDate() - dayNum + 3);            // nearest Thursday
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  return 1 + Math.round((d - firstThursday) / (7 * 86400000));
}
