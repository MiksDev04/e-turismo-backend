// ─── Visitor Estimation Config (VAR 1 / VAR 2 attraction reports) ───────────
// Applied ONLY at report-generation time, once per group per day. Raw rows are
// never backfilled with a guessed value at save time — a blank route keeps its
// NULLs and the estimate is produced when a report is generated.
//
// Origin: [CITE-YOUR-PLACE-OF-RESIDENCE-STUDY HERE — replace the placeholder
//   figures below with the real study's distribution before shipping.
//   Distribution across: This City/Municipality, Other City/Municipality,
//   Other Province, Foreign Country Residence.]
//
// Gender: PSA 47.1% male / 52.9% female national average
//   (Philippine Statistics Authority; travelers within the Philippines lean
//   slightly toward females, 52.9% vs 47.1%).
const distributionConfig = {
  origin: {
    thisCityPct: 0.55,
    otherCityPct: 0.20,
    otherProvincePct: 0.15,
    foreignPct: 0.10,
  },
  gender: {
    malePct: 0.471,
    femalePct: 0.529,
  },
};

// Order the origin categories are applied in (must sum to 1.0).
export const kOriginCategories = ['thisCity', 'otherCity', 'otherProvince', 'foreign'];

// Convenience: per-category origin fractions keyed by that canonical category name.
export const kOriginPct = {
  thisCity: distributionConfig.origin.thisCityPct,
  otherCity: distributionConfig.origin.otherCityPct,
  otherProvince: distributionConfig.origin.otherProvincePct,
  foreign: distributionConfig.origin.foreignPct,
};

export default distributionConfig;