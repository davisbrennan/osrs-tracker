/**
 * Small CSV parser. Handles quoted fields, embedded commas, escaped quotes
 * ("" inside a quoted field) and CRLF — which covers what Excel and Google
 * Sheets actually export. No dependency for ~60 lines.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const src = text.replace(/^\uFEFF/, ''); // strip Excel’s byte-order mark

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Column aliases people actually use in their spreadsheets. */
const HEADER_MAP: Record<string, string> = {
  name: 'name',
  'full name': 'name',
  guest: 'name',
  'guest name': 'name',
  first: 'first',
  'first name': 'first',
  firstname: 'first',
  last: 'last',
  'last name': 'last',
  lastname: 'last',
  surname: 'last',
  party: 'party',
  household: 'party',
  group: 'party',
  family: 'party',
  side: 'side',
  email: 'email',
  'e-mail': 'email',
  phone: 'phone',
  mobile: 'phone',
  age: 'age',
  'age group': 'age',
  type: 'age',
  meal: 'dietary',
  dietary: 'dietary',
  'dietary notes': 'dietary',
  diet: 'dietary',
  rsvp: 'rsvp',
  status: 'rsvp',
  'rsvp status': 'rsvp',
  attending: 'rsvp',
  notes: 'notes',
  note: 'notes',
  comment: 'notes',
};

export type ImportRow = {
  first: string;
  last: string | null;
  party: string | null;
  side: string;
  ageGroup: string;
  email: string | null;
  dietary: string | null;
  notes: string | null;
  rsvp: string;
};

function normSide(v: string): string {
  const s = v.trim().toLowerCase();
  if (['a', 'partner_a', 'bride', 'hers', 'his', '1'].includes(s)) return 'partner_a';
  if (['b', 'partner_b', 'groom', '2'].includes(s)) return 'partner_b';
  return 'both';
}

function normAge(v: string): string {
  const s = v.trim().toLowerCase();
  if (s.startsWith('child') || s === 'kid' || s === 'kids') return 'child';
  if (s.startsWith('infant') || s.startsWith('baby')) return 'infant';
  return 'adult';
}

function normRsvp(v: string): string {
  const s = v.trim().toLowerCase();
  if (['yes', 'y', 'coming', 'accepted', 'attending', 'true', '1'].includes(s)) return 'yes';
  if (['no', 'n', 'declined', 'not coming', 'false', '0'].includes(s)) return 'no';
  if (s.startsWith('maybe')) return 'maybe';
  return 'pending';
}

export function mapGuestRows(rows: string[][]): { rows: ImportRow[]; skipped: number } {
  if (rows.length === 0) return { rows: [], skipped: 0 };

  const header = rows[0].map((h) => HEADER_MAP[h.trim().toLowerCase()] ?? '');
  const hasHeader = header.some(Boolean);
  const body = hasHeader ? rows.slice(1) : rows;
  const cols = hasHeader ? header : ['name'];

  const out: ImportRow[] = [];
  let skipped = 0;

  for (const r of body) {
    const get = (key: string): string => {
      const i = cols.indexOf(key);
      return i >= 0 && r[i] !== undefined ? r[i].trim() : '';
    };

    let first = get('first');
    let last = get('last');
    const whole = get('name');
    if (!first && whole) {
      const w = whole.trim();
      if (w.includes(',')) {
        // "Alvarez, Ana" — the Last, First convention spreadsheets love.
        const [surname, given] = w.split(',', 2);
        first = (given ?? '').trim();
        last = surname.trim();
        if (!first) {
          first = last;
          last = '';
        }
      } else {
        const parts = w.split(/\s+/);
        first = parts[0] ?? '';
        last = parts.slice(1).join(' ');
      }
    }

    if (!first) {
      skipped++;
      continue;
    }

    out.push({
      first,
      last: last || null,
      party: get('party') || null,
      side: normSide(get('side')),
      ageGroup: normAge(get('age')),
      email: get('email').toLowerCase() || null,
      dietary: get('dietary') || null,
      notes: get('notes') || null,
      rsvp: normRsvp(get('rsvp')),
    });
  }

  return { rows: out, skipped };
}
