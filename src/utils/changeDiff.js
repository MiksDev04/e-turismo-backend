function normalizeValue(column, value) {
  if (value === null || value === undefined || value === '') return null;

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((v) => (typeof v === 'string' ? v.trim() : v));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;

    const isArrayField = column === 'business_line' || column === 'attraction_type';
    if (isArrayField || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          if (parsed.length === 0) return null;
          return parsed.map((v) => (typeof v === 'string' ? v.trim() : v));
        }
      } catch (e) {
        // fall through to trimmed string
      }
    }
    return trimmed;
  }

  return value;
}

function displayValue(column, value) {
  const normalized = normalizeValue(column, value);
  if (normalized === null) return '';
  if (Array.isArray(normalized)) return normalized.map((v) => String(v)).join(', ');
  return String(normalized);
}

function truncate(value) {
  if (value.length > 100) return value.slice(0, 100) + '…';
  return value;
}

function valuesEqual(column, a, b) {
  const na = normalizeValue(column, a);
  const nb = normalizeValue(column, b);
  if (Array.isArray(na) || Array.isArray(nb)) {
    return JSON.stringify(na) === JSON.stringify(nb);
  }
  return na === nb;
}

export function buildChangeDetails(before, after, fieldMap) {
  const entries = [];
  for (const column of Object.keys(fieldMap || {})) {
    const label = fieldMap[column];
    const oldRaw = before ? before[column] : undefined;
    const newRaw = after ? after[column] : undefined;

    if (valuesEqual(column, oldRaw, newRaw)) continue;

    const oldDisplay = truncate(displayValue(column, oldRaw));
    const newDisplay = truncate(displayValue(column, newRaw));

    if (oldDisplay === '') {
      entries.push(`Set ${label} to "${newDisplay}"`);
    } else if (newDisplay === '') {
      entries.push(`Cleared ${label} (was "${oldDisplay}")`);
    } else {
      entries.push(`Changed ${label} from "${oldDisplay}" to "${newDisplay}"`);
    }
  }
  if (entries.length === 0) return null;
  return entries.join('; ');
}

export default buildChangeDetails;