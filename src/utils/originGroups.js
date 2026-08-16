// Origin Groups: repeatable Country / Province / City-Municipality /
// Male / Female rows shared by guest_records (accommodation) and
// attraction_visit_logs (attraction). Exactly one parent per row.
//
// Validation rules (mirror the guest_origin_breakdowns CHECKs):
//   - maleCount + femaleCount >= 1
//   - country is required unless isOverseas = 1 (overseas Filipino)
//   - province / cityMunicipality are Philippines-only
//   - province / cityMunicipality are never allowed for overseas groups
//   - maleCount / femaleCount are non-negative integers

export function parseOriginGroups(list) {
  if (!Array.isArray(list)) {
    return { ok: false, message: 'originGroups must be an array' };
  }

  const groups = [];
  for (const raw of list) {
    const country = typeof raw?.country === 'string' ? raw.country.trim() : '';
    const province = typeof raw?.province === 'string' ? raw.province.trim() : '';
    const cityMunicipality = typeof raw?.cityMunicipality === 'string' ? raw.cityMunicipality.trim() : '';
    const isOverseas = !!raw?.isOverseas;
    const maleCount = parseInt(raw?.maleCount, 10);
    const femaleCount = parseInt(raw?.femaleCount, 10);

    if (isNaN(maleCount) || isNaN(femaleCount) || maleCount < 0 || femaleCount < 0) {
      return { ok: false, message: 'maleCount and femaleCount must be non-negative integers' };
    }
    if (maleCount + femaleCount < 1) {
      return { ok: false, message: 'Each origin group must have at least one guest (maleCount + femaleCount >= 1)' };
    }
    if (!isOverseas && !country) {
      return { ok: false, message: 'country is required for a non-overseas origin group' };
    }
    if (country && country !== 'Philippines' && (province || cityMunicipality)) {
      return { ok: false, message: 'province and cityMunicipality are only valid for the Philippines' };
    }
    if (isOverseas && (province || cityMunicipality)) {
      return { ok: false, message: 'Overseas Filipino groups cannot have a province or city/municipality' };
    }

    groups.push({
      country: country || null,
      isOverseas,
      province: province || null,
      cityMunicipality: cityMunicipality || null,
      maleCount,
      femaleCount,
    });
  }

  return { ok: true, groups };
}

// Row JSON (camelCase) ⇄ SQL row (snake_case).
export function breakdownToJson(row) {
  return {
    id: row.id,
    country: row.country,
    isOverseas: row.is_overseas === 1 || row.is_overseas === true,
    province: row.province,
    cityMunicipality: row.city_municipality,
    maleCount: row.male_count,
    femaleCount: row.female_count,
  };
}

export default { parseOriginGroups, breakdownToJson };
