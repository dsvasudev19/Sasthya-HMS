/** A forgiving CSV reader: quotes, commas inside quotes, and either line ending. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += c }
    else if (c === '"') quoted = true
    else if (c === ',') { cur.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; cur.push(cell); cell = ''; if (cur.some((x) => x.trim())) rows.push(cur); cur = [] }
    else cell += c
  }
  cur.push(cell); if (cur.some((x) => x.trim())) rows.push(cur)
  return rows
}

