// Pure core for home-health-hospice-ratings-care-compare-mcp. The only I/O is keyless reads of the CMS Provider Data
// Catalog (the data behind Medicare.gov Care Compare) on data.cms.gov, done through an injected fetchText.
//
// DKAN datastore query API https://data.cms.gov/provider-data/api/1/datastore/query/<id>/0 (limit at most 1500, every value text)
//   Home health:  6jpm-sxkc agencies (quality of patient care star rating in half stars, services, OASIS and claims measures)
//                 ccn4-8vby HHCAHPS patient survey (summary and topic stars), m5jg-jg7i state, vxub-6swi national
//                 m5eg-upu5 ZIP codes each agency serves, tee5-ixt5 state averages, 97z8-de96 national averages
//   Hospice:      yc9t-dgbk general information, 252m-zfp9 provider measures (long format: one row per measure_code),
//                 gxki-hrr8 CAHPS Hospice Survey (family caregiver star rating and topic scores), a55e-5b88 state, 7cv8-v37d national,
//                 eda0-92f0 state measures, 3xeb-u9wp national measures, 95rg-2usp ZIP codes each hospice serves
//   metastore     https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/<id>  (modified date = as_of)
// Footnotes: the home health agency file writes the footnote text itself ("-" for none); HHCAHPS and every hospice file
// write footnote numbers, explained in the CMS data dictionaries (HHQRP Table 14, Hospice Table 16).
import type { FetchText } from './types.js';

export const REPO = 'home-health-hospice-ratings-care-compare-mcp';
export const SITE = 'https://www.mcpstamp.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const more = () => `${SITE}/servers/?${UTM}`;
export const API = 'https://data.cms.gov/provider-data/api/1';
export const SOURCE_HH = 'CMS Care Compare (Medicare.gov) home health data from the CMS Provider Data Catalog on data.cms.gov: Home Health Care Agencies, Patient Survey (HHCAHPS), ZIP codes served, state and national data.';
export const SOURCE_HOSPICE = 'CMS Care Compare (Medicare.gov) hospice data from the CMS Provider Data Catalog on data.cms.gov: Hospice General Information, Provider Data, CAHPS Hospice Survey, ZIP codes served, state and national data.';
export const DS = {
  hh: '6jpm-sxkc', hhCahps: 'ccn4-8vby', hhZip: 'm5eg-upu5', hhState: 'tee5-ixt5', hhNation: '97z8-de96',
  hhCahpsState: 'm5jg-jg7i', hhCahpsNation: 'vxub-6swi',
  hospice: 'yc9t-dgbk', hospiceMeasures: '252m-zfp9', hospiceCahps: 'gxki-hrr8', hospiceZip: '95rg-2usp',
  hospiceState: 'eda0-92f0', hospiceNation: '3xeb-u9wp', hospiceCahpsState: 'a55e-5b88', hospiceCahpsNation: '7cv8-v37d',
} as const;
const TTL = 21600;

export class InputError extends Error {}
export class UpstreamError extends Error {}

// HHQRP and HHVBP Data Dictionary (April 2026), Table 14. Used by the HHCAHPS footnote columns.
export const HH_FOOTNOTES: Record<string, string> = {
  '1': 'This agency provides services under a federal waiver program to non-traditional, chronic long term population.',
  '2': 'This agency provides services to a special needs population.',
  '3': 'Not Available.',
  '4': 'The number of patient episodes for this measure is too small to report.',
  '5': 'This measure currently does not have data or provider has been certified/recertified for less than 6 months.',
  '6': 'The national average for this measure is not provided because of state-to-state differences in data collection.',
  '7': 'Medicare is not displaying rates for this measure for any home health agency, because of an issue with the data.',
  '8': 'There were problems with the data and they are being corrected.',
  '9': "Zero, or very few, patients met the survey's rules for inclusion. The scores shown, if any, reflect a very small number of surveys and may not accurately tell how an agency is doing.",
  '10': 'Survey results are based on less than 12 months of data.',
  '11': 'Fewer than 70 patients completed the survey. Use the scores shown, if any, with caution as the number of surveys may be too low to accurately tell how an agency is doing.',
  '12': 'No survey results are available for this period.',
  '13': 'Data suppressed by CMS for one or more quarters.',
};
// Hospice Data Dictionary, Table 16 (footnote as displayed on Care Compare).
export const HOSPICE_FOOTNOTES: Record<string, string> = {
  '1': 'The number of eligible cases (stays, claims, etc.) is too small to report.',
  '2': 'Data not available for this reporting period (certified less than 6 months for HIS measures or 1 month for claims measures, or no data to submit).',
  '3': 'Data suppressed by CMS upon request from the agency.',
  '4': 'Data not submitted for this reporting period.',
  '5': 'Results are based on a shorter time period than required.',
  '6': 'The number of cases is too small to report.',
  '7': 'Results are based on a shorter time period than required.',
  '8': 'Data suppressed by CMS.',
  '9': 'There were discrepancies in the data collection process.',
  '10': 'None of the required data were submitted for this reporting period.',
  '11': "Results aren't available for this reporting period (the agency is too new or too small to take part in the CAHPS Hospice Survey, or no cases met the criteria).",
  '12': "Results aren't available (no Hospice PUF data for the relevant calendar years).",
  '13': 'Number of patients is too small to report.',
  '14': 'Value only reflects the specific year of data used for the current refresh, and does not mean a hospice has not provided care at this site in more recent years or is unable to provide care at this site.',
  '15': 'The number of cases is too small to report Star Ratings.',
  '16': 'The number of cases is too small to report a score for this state/territory.',
};
export function codeNote(table: Record<string, string>, codes: unknown): string | null {
  const c = String(codes ?? '').split(',').map((s) => s.trim()).filter((s) => s && s !== '-');
  if (!c.length) return null;
  return c.map((x) => table[x] ?? `CMS footnote ${x}.`).join(' ');
}
/** The home health agency file writes footnote text, or "-" for none. */
export function textNote(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return !s || s === '-' ? null : s;
}

export const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
  GU: 'Guam', VI: 'Virgin Islands', AS: 'American Samoa', MP: 'Northern Mariana Islands',
};
export function stateCode(s: unknown): string {
  const v = String(s ?? '').trim();
  const up = v.toUpperCase().replace(/\./g, '');
  if (STATES[up]) return up;
  const hit = Object.entries(STATES).find(([, n]) => n.toUpperCase() === up);
  if (hit) return hit[0];
  throw new InputError(`"${v}" is not a US state. Use a two-letter code such as VT or a name such as Vermont.`);
}
export function zip5(z: unknown): string {
  const s = String(z ?? '').trim();
  const m = /^(\d{5})(-\d{4})?$/.exec(s) ?? /^(\d{4})$/.exec(s);
  if (!m) throw new InputError(`"${s}" is not a ZIP code. Use 5 digits, such as 05401.`);
  return m[1].padStart(5, '0');
}

// ---------- DKAN query ----------

export type Op = '=' | 'like' | 'in';
export interface Cond { property: string; value: string | string[]; operator?: Op }
export interface Query { conditions?: Cond[]; properties?: string[]; limit?: number; offset?: number }
type Row = Record<string, string>;

export function queryUrl(ds: string, q: Query): string {
  const p: string[] = [`limit=${q.limit ?? 1500}`];
  if (q.offset) p.push(`offset=${q.offset}`);
  (q.properties ?? []).forEach((x) => p.push(`properties[]=${encodeURIComponent(x)}`));
  (q.conditions ?? []).forEach((c, i) => {
    p.push(`conditions[${i}][property]=${encodeURIComponent(c.property)}`);
    if (Array.isArray(c.value)) c.value.forEach((v, j) => p.push(`conditions[${i}][value][${j}]=${encodeURIComponent(v)}`));
    else p.push(`conditions[${i}][value]=${encodeURIComponent(c.value)}`);
    p.push(`conditions[${i}][operator]=${encodeURIComponent(c.operator ?? (Array.isArray(c.value) ? 'in' : '='))}`);
  });
  p.push('schema=false', 'results=true');
  return `${API}/datastore/query/${ds}/0?${p.join('&')}`;
}

async function read(f: FetchText, url: string): Promise<string> {
  try {
    return await f(url, { cacheTtl: TTL, timeoutMs: 20000 });
  } catch (e) {
    // data.cms.gov sits behind Akamai, which now and then answers a burst of reads with HTTP 403. One retry after a pause.
    if (!/HTTP 403/.test((e as Error).message)) throw new UpstreamError(`data.cms.gov did not answer (${(e as Error).message}). Try again in a minute.`);
    await new Promise((r) => setTimeout(r, 1200));
    try {
      return await f(url, { cacheTtl: TTL, timeoutMs: 20000 });
    } catch (e2) {
      throw new UpstreamError(`data.cms.gov did not answer (${(e2 as Error).message}). Try again in a minute.`);
    }
  }
}

export async function query(f: FetchText, ds: string, q: Query): Promise<{ rows: Row[]; count: number }> {
  const body = await read(f, queryUrl(ds, q));
  let d: any;
  try { d = JSON.parse(body); } catch { throw new UpstreamError('data.cms.gov returned something that is not JSON.'); }
  if (!d || !Array.isArray(d.results)) throw new UpstreamError(`data.cms.gov query failed: ${String(d?.message ?? 'no results array').slice(0, 200)}`);
  return { rows: d.results as Row[], count: typeof d.count === 'number' ? d.count : d.results.length };
}

/** Every matching row: pages of 1500 while the count says there are more (at most 6 pages, 9000 rows). */
export async function queryAll(f: FetchText, ds: string, q: Query): Promise<Row[]> {
  const first = await query(f, ds, { ...q, limit: 1500, offset: 0 });
  const rows = first.rows.slice();
  const pages = Math.min(Math.ceil(first.count / 1500), 6);
  if (pages > 1) {
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => query(f, ds, { ...q, limit: 1500, offset: (i + 1) * 1500 })));
    for (const r of rest) rows.push(...r.rows);
  }
  return rows;
}

/** Rows whose `property` is in `values`, read in batches of 150 values per request. */
export async function queryIn(f: FetchText, ds: string, property: string, values: string[], extra: Cond[] = [], properties?: string[]): Promise<Row[]> {
  const uniq = [...new Set(values)];
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += 150) chunks.push(uniq.slice(i, i + 150));
  const parts = await Promise.all(chunks.map((c) => queryAll(f, ds, { conditions: [{ property, value: c, operator: 'in' }, ...extra], properties })));
  return parts.flat();
}

export async function modified(f: FetchText, ds: string): Promise<string | null> {
  try {
    const m = JSON.parse(await f(`${API}/metastore/schemas/dataset/items/${ds}`, { cacheTtl: TTL, timeoutMs: 15000 }));
    return typeof m.modified === 'string' ? m.modified : null;
  } catch {
    return null;
  }
}

// ---------- values ----------

export function num(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (!s || s === '-' || /^not (available|applicable)$/i.test(s)) return null;
  const n = Number(s.replace(/[,$%]/g, ''));
  return Number.isFinite(n) ? n : null;
}
export function isoDate(v: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v ?? '').trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}
export function period(v: unknown): string | null {
  const m = /^(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})$/.exec(String(v ?? '').trim());
  return m ? `${isoDate(m[1])} to ${isoDate(m[2])}` : null;
}
const SMALL = new Set(['OF', 'AND', 'THE', 'AT', 'FOR', 'IN', 'ON']);
export function titleCase(s: string): string {
  return s.toLowerCase().split(/(\s+|-|\/)/).map((w, i) => {
    if (!w.trim() || w === '-' || w === '/') return w;
    if (i > 0 && SMALL.has(w.toUpperCase())) return w;
    if (/^(ii|iii|iv|llc|inc|pllc|lp|vna|vnh|hha|uvmhn|usa|us|pc|dba|nh|vt|ny|nyc|hcr)$/i.test(w.replace(/[.,]/g, ''))) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join('').replace(/'S\b/g, "'s");
}
export function phone(p: unknown): string | null {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (String(p ?? '').trim() || null);
}
const stars = (n: number | null) => (n === null ? 'not rated' : `${n} star${n === 1 ? '' : 's'}`);

// ---------- name matching ----------

const STOP = new Set(['THE', 'OF', 'AND', 'HOME', 'HEALTH', 'HEALTHCARE', 'CARE', 'HOSPICE', 'PALLIATIVE', 'SERVICES', 'SERVICE', 'AGENCY', 'INC', 'LLC', 'CORP',
  'CO', 'AT', 'FOR', 'IN', 'HHA', 'DBA', 'OF']);
const ABBR: Record<string, string> = { SAINT: 'ST', MOUNT: 'MT', FORT: 'FT', VISITING: 'VISITING', NURSES: 'NURSE', ASSOCIATION: 'ASSN' };
export function nameTokens(s: string): string[] {
  return s.toUpperCase().replace(/['’.]/g, '').split(/[^A-Z0-9]+/).filter(Boolean).map((t) => ABBR[t] ?? t);
}
const tokMatch = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
export function scoreName(input: string, candidate: string): number {
  const all = nameTokens(input);
  const want = all.filter((t) => !STOP.has(t));
  const ts = want.length ? want : all;
  if (!ts.length) return 0;
  const have = nameTokens(candidate);
  const hit = ts.filter((t) => have.some((h) => tokMatch(t, h))).length;
  const extra = have.filter((h) => !STOP.has(h) && !ts.some((t) => tokMatch(t, h))).length;
  return hit / ts.length - extra * 0.01;
}
export function likeToken(input: string): string {
  const all = nameTokens(input);
  const ts = all.filter((t) => !STOP.has(t) && !['ST', 'MT', 'FT'].includes(t));
  const pick = (ts.length ? ts : all).slice().sort((a, b) => b.length - a.length)[0];
  if (!pick) throw new InputError('Give a name with at least one word, or a CMS certification number (6 digits, such as 477000).');
  return pick.slice(0, 5);
}
export function normalizeCcn(id: unknown): string {
  const s = String(id ?? '').trim().toUpperCase();
  if (!/^[0-9A-Z]{6}$/.test(s)) throw new InputError(`"${id}" is not a CMS certification number (CCN). It has 6 characters, for example 477000.`);
  return s;
}

export interface Ref { ccn?: string; name?: string; state?: string; city?: string }
type Kind = 'hh' | 'hospice';
const KIND = {
  hh: { ds: DS.hh, nameCol: 'provider_name', label: 'home health agency', search: 'home_health_search' },
  hospice: { ds: DS.hospice, nameCol: 'facility_name', label: 'hospice', search: 'hospice_search' },
} as const;

/** Resolve one agency by CCN, or by name (optionally state and city). */
export async function resolve(f: FetchText, kind: Kind, ref: Ref): Promise<{ row: Row; other_matches: { ccn: string; name: string; city: string; state: string }[] }> {
  const k = KIND[kind];
  if (ref.ccn) {
    const id = normalizeCcn(ref.ccn);
    const { rows } = await query(f, k.ds, { conditions: [{ property: 'cms_certification_number_ccn', value: id }], limit: 5 });
    if (!rows.length) throw new InputError(`No CMS-certified ${k.label} has CCN ${id}. Use ${k.search} to find it.`);
    return { row: rows[0], other_matches: [] };
  }
  const name = String(ref.name ?? '').trim();
  if (!name) throw new InputError('Give a ccn or a name.');
  const conds: Cond[] = [{ property: k.nameCol, value: `%${likeToken(name)}%`, operator: 'like' }];
  if (ref.state) conds.unshift({ property: 'state', value: stateCode(ref.state) });
  if (ref.city) conds.push({ property: 'citytown', value: String(ref.city).trim().toUpperCase().replace(/^ST\.? /, 'SAINT ') });
  const rows = await queryAll(f, k.ds, { conditions: conds });
  const scored = rows.map((r) => ({ r, s: scoreName(name, r[k.nameCol]) })).filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s || a.r[k.nameCol].localeCompare(b.r[k.nameCol]));
  if (!scored.length) {
    const where = [ref.city, ref.state].filter(Boolean).join(', ');
    throw new InputError(`No CMS-certified ${k.label} name matches "${name}"${where ? ` in ${where}` : ''}. Try ${k.search} with a ZIP code or state, or a shorter part of the name.`);
  }
  const best = scored[0];
  const other = scored.slice(1, 6).filter((x) => x.s >= best.s - 0.34)
    .map((x) => ({ ccn: x.r.cms_certification_number_ccn, name: titleCase(x.r[k.nameCol]), city: titleCase(x.r.citytown), state: x.r.state }));
  return { row: best.r, other_matches: other };
}

async function zipCount(f: FetchText, ds: string, ccn: string): Promise<number | null> {
  try {
    return (await query(f, ds, { conditions: [{ property: 'cms_certification_number_ccn', value: ccn }], properties: ['zip_code'], limit: 1 })).count;
  } catch {
    return null;
  }
}

// ---------- home health ----------

export const HH_SERVICES: [string, string][] = [
  ['nursing', 'offers_nursing_care_services'], ['physical_therapy', 'offers_physical_therapy_services'],
  ['occupational_therapy', 'offers_occupational_therapy_services'], ['speech_therapy', 'offers_speech_pathology_services'],
  ['medical_social_services', 'offers_medical_social_services'], ['home_health_aide', 'offers_home_health_aide_services'],
];
// [id, plain-language name (as on Care Compare), value column, footnote column, better]
export const HH_MEASURES: [string, string, string, string, 'higher' | 'lower'][] = [
  ['timely_start', 'How often the home health team began patients\' care in a timely manner', 'how_often_the_home_health_team_began_their_patients_care_in_d440', 'footnote_for_how_often_the_home_health_team_began_their_pat_6aee', 'higher'],
  ['flu_shot', 'How often the team determined whether patients received a flu shot for the current flu season', 'how_often_the_home_health_team_determined_whether_patients__4505', 'footnote_for_how_often_the_home_health_team_determined_whet_5002', 'higher'],
  ['walking', 'How often patients got better at walking or moving around', 'how_often_patients_got_better_at_walking_or_moving_around', 'footnote_for_how_often_patients_got_better_at_walking_or_mo_e2ff', 'higher'],
  ['bed_transfer', 'How often patients got better at getting in and out of bed', 'how_often_patients_got_better_at_getting_in_and_out_of_bed', 'footnote_for_how_often_patients_got_better_at_getting_in_an_7940', 'higher'],
  ['bathing', 'How often patients got better at bathing', 'how_often_patients_got_better_at_bathing', 'footnote_for_how_often_patients_got_better_at_bathing', 'higher'],
  ['breathing', 'How often patients\' breathing improved', 'how_often_patients_breathing_improved', 'footnote_for_how_often_patients_breathing_improved', 'higher'],
  ['oral_medications', 'How often patients got better at taking their drugs correctly by mouth', 'how_often_patients_got_better_at_taking_their_drugs_correct_bd88', 'footnote_for_how_often_patients_got_better_at_taking_their__dd00', 'higher'],
  ['medication_issues', 'How often physician-recommended actions to address medication issues were completely timely', 'how_often_physicianrecommended_actions_to_address_medicatio_cc88', 'footnote_for_how_often_physicianrecommended_actions_to_addr_0c32', 'higher'],
  ['pressure_ulcers', 'Patients with pressure ulcers or injuries that are new or worsened', 'changes_in_skin_integrity_postacute_care_pressure_ulcerinjury', 'footnote_changes_in_skin_integrity_postacute_care_pressure__d758', 'lower'],
  ['falls_major_injury', 'Patients with one or more falls with major injury', 'percent_of_residents_experiencing_one_or_more_falls_with_ma_34b8', 'footnote_for_percent_of_residents_experiencing_one_or_more__4fe2', 'lower'],
  ['discharge_function', 'Discharge function score (patients at or above the expected ability to care for themselves and move around at discharge)', 'discharge_function_score', 'footnote_for_discharge_function_score', 'higher'],
  ['info_to_provider', 'Transfer of health information to the next provider', 'transfer_of_health_information_to_the_provider', 'footnote_for_transfer_of_health_information_to_the_provider', 'higher'],
  ['info_to_patient', 'Transfer of health information to the patient', 'transfer_of_health_information_to_the_patient', 'footnote_for_transfer_of_health_information_to_the_patient', 'higher'],
];
// Claims-based outcomes with a risk-standardized rate and a CMS category against the national rate.
export const HH_CLAIMS: [string, string, string, 'higher' | 'lower'][] = [
  ['dtc', 'discharged_to_community', 'How often patients remained at home after discharge from home health (discharge to community)', 'higher'],
  ['ppr', 'preventable_readmissions', 'Potentially preventable hospital readmissions after discharge from home health', 'lower'],
  ['pph', 'preventable_hospitalizations', 'Potentially preventable hospitalizations during home health care', 'lower'],
];
const HH_SPEND = 'how_much_medicare_spends_on_an_episode_of_care_at_this_agen_56e6';
const HH_SPEND_STATE = 'how_much_medicare_spends_on_an_episode_of_care_by_agencies__e8d7';
// HHCAHPS [topic, star column, percent column, star footnote column]
export const HH_SURVEY: [string, string, string, string][] = [
  ['Care given in a professional way', 'star_rating_for_health_team_gave_care_in_a_professional_way', 'percent_of_patients_who_reported_that_their_home_health_tea_c7be', 'footnote_for_star_rating_for_gave_care_in_a_professional_way'],
  ['Team communicated well with them', 'star_rating_for_health_team_communicated_well_with_them', 'percent_of_patients_who_reported_that_their_home_health_tea_7896', 'footnote_for_star_rating_for_communicated_well_with_them'],
  ['Team discussed medicines, pain and home safety', 'star_rating_team_discussed_medicines_pain_and_home_safety', 'percent_of_patients_who_reported_that_their_home_health_tea_7ba5', 'footnote_star_rating_discussed_medicines_pain_home_safety'],
  ['Patients rated the agency 9 or 10 out of 10', 'star_rating_for_how_patients_rated_overall_care_from_agency', 'percent_of_patients_who_gave_their_home_health_agency_a_rat_187c', 'footnote_for_star_rating_for_overall_care_from_agency'],
];
const HH_RECOMMEND = 'percent_of_patients_who_reported_yes_they_would_definitely__2707';
const HH_RATE910 = 'percent_of_patients_who_gave_their_home_health_agency_a_rat_187c';

const HH_BRIEF_PROPS = ['state', 'cms_certification_number_ccn', 'provider_name', 'address', 'citytown', 'zip_code', 'telephone_number', 'type_of_ownership',
  ...HH_SERVICES.map((s) => s[1]), 'certification_date', 'quality_of_patient_care_star_rating', 'footnote_for_quality_of_patient_care_star_rating'];

export function hhBrief(r: Row) {
  const q = num(r.quality_of_patient_care_star_rating);
  return {
    ccn: r.cms_certification_number_ccn, name: titleCase(r.provider_name ?? ''), address: titleCase(r.address ?? ''),
    city: titleCase(r.citytown ?? ''), state: r.state, zip: r.zip_code, phone: phone(r.telephone_number),
    ownership: titleCase(r.type_of_ownership ?? ''), certified_since: isoDate(r.certification_date),
    quality_stars: q, quality_stars_note: q === null ? (textNote(r.footnote_for_quality_of_patient_care_star_rating) ?? 'No quality of patient care star rating.') : null,
    services: HH_SERVICES.filter(([, c]) => r[c] === 'Yes').map(([s]) => s),
    care_compare_url: `https://www.medicare.gov/care-compare/details/home-health/${r.cms_certification_number_ccn}`,
  };
}

export interface HomeHealthSearchArgs { zip?: string; city?: string; state?: string; name?: string; services?: string[]; min_stars?: number; sort?: 'quality' | 'patient_survey' | 'name'; limit?: number }

export async function homeHealthSearch(f: FetchText, a: HomeHealthSearchArgs) {
  const st = a.state ? stateCode(a.state) : null;
  let rows: Row[];
  let where: string;
  let zip: string | null = null;
  if (a.zip) {
    zip = zip5(a.zip);
    const served = await queryAll(f, DS.hhZip, { conditions: [{ property: 'zip_code', value: zip }] });
    const ccns = served.map((r) => r.cms_certification_number_ccn);
    rows = ccns.length ? await queryIn(f, DS.hh, 'cms_certification_number_ccn', ccns, [], HH_BRIEF_PROPS) : [];
    where = `serving ZIP ${zip}`;
  } else {
    const conds: Cond[] = [];
    if (st) conds.push({ property: 'state', value: st });
    if (a.city) conds.push({ property: 'citytown', value: String(a.city).trim().toUpperCase().replace(/^ST\.? /, 'SAINT ') });
    if (a.name) conds.push({ property: 'provider_name', value: `%${likeToken(a.name)}%`, operator: 'like' });
    if (!conds.length) throw new InputError('Give a ZIP code (agencies that serve it), or a state, city or agency name.');
    rows = await queryAll(f, DS.hh, { conditions: conds, properties: HH_BRIEF_PROPS });
    where = [a.name && `named like "${a.name}"`, a.city && `with an office in ${titleCase(String(a.city))}`, st && `in ${STATES[st]}`].filter(Boolean).join(' ');
  }
  if (a.name) rows = rows.filter((r) => scoreName(a.name as string, r.provider_name) >= 0.5);
  if (a.zip && st) rows = rows.filter((r) => r.state === st);
  const want = (a.services ?? []).map((s) => {
    const hit = HH_SERVICES.find(([k]) => k === s);
    if (!hit) throw new InputError(`services must be from: ${HH_SERVICES.map((x) => x[0]).join(', ')}.`);
    return hit[1];
  });
  rows = rows.filter((r) => want.every((c) => r[c] === 'Yes'));
  const dist: Record<string, number> = { '5': 0, '4.5': 0, '4': 0, '3.5': 0, '3': 0, '2.5': 0, '2': 0, '1.5': 0, '1': 0, not_rated: 0 };
  for (const r of rows) { const q = num(r.quality_of_patient_care_star_rating); dist[q === null ? 'not_rated' : String(q)] = (dist[q === null ? 'not_rated' : String(q)] ?? 0) + 1; }
  const matched = rows.length;
  if (a.min_stars) rows = rows.filter((r) => (num(r.quality_of_patient_care_star_rating) ?? 0) >= (a.min_stars as number));
  const sort = a.sort ?? 'quality';
  const limit = Math.min(Math.max(a.limit ?? 15, 1), 50);
  // Patient survey stars: for every candidate when they decide the order, otherwise only for the agencies shown.
  const survey = new Map<string, Row>();
  const getSurvey = async (ccns: string[]) => {
    const need = ccns.filter((c) => !survey.has(c));
    if (!need.length) return;
    try {
      for (const r of await queryIn(f, DS.hhCahps, 'cms_certification_number_ccn', need, [], ['cms_certification_number_ccn', 'hhcahps_survey_summary_star_rating', 'hhcahps_survey_summary_star_rating_footnote', HH_RATE910, HH_RECOMMEND])) survey.set(r.cms_certification_number_ccn, r);
    } catch { /* survey stars are an extra; the ranking still works without them */ }
  };
  if (sort === 'patient_survey' || rows.length <= 150) await getSurvey(rows.map((r) => r.cms_certification_number_ccn));
  const ps = (r: Row) => num(survey.get(r.cms_certification_number_ccn)?.hhcahps_survey_summary_star_rating);
  const q = (r: Row) => num(r.quality_of_patient_care_star_rating);
  const byName = (x: Row, y: Row) => x.provider_name.localeCompare(y.provider_name);
  rows = rows.slice().sort(sort === 'name' ? byName
    : sort === 'patient_survey' ? (x, y) => (ps(y) ?? -1) - (ps(x) ?? -1) || (q(y) ?? -1) - (q(x) ?? -1) || byName(x, y)
      : (x, y) => (q(y) ?? -1) - (q(x) ?? -1) || (ps(y) ?? -1) - (ps(x) ?? -1) || byName(x, y));
  const shown = rows.slice(0, limit);
  await getSurvey(shown.map((r) => r.cms_certification_number_ccn));
  const agencies = shown.map((r) => {
    const s = survey.get(r.cms_certification_number_ccn);
    const pstar = num(s?.hhcahps_survey_summary_star_rating);
    return {
      ...hhBrief(r), patient_survey_stars: pstar,
      patient_survey_note: s && pstar === null ? codeNote(HH_FOOTNOTES, s.hhcahps_survey_summary_star_rating_footnote) : null,
      rated_9_or_10_pct: num(s?.[HH_RATE910]), would_definitely_recommend_pct: num(s?.[HH_RECOMMEND]),
    };
  });
  const asOf = await modified(f, DS.hh);
  const top = agencies.slice(0, 5).map((h) => `${h.name} (${h.city}, ${h.state}): quality ${stars(h.quality_stars)}, patient survey ${stars(h.patient_survey_stars)}`);
  const rated = Object.entries(dist).filter(([k, v]) => k !== 'not_rated' && v).map(([k, v]) => `${k}: ${v}`).join(', ');
  const summary = matched === 0
    ? `No Medicare-certified home health agencies ${where}${want.length ? ` offering ${a.services!.join(', ')}` : ''}.`
    : `${matched} Medicare-certified home health agenc${matched === 1 ? 'y' : 'ies'} ${where}${want.length ? ` offering ${a.services!.join(', ')}` : ''}` +
      ` (quality star ratings ${rated || 'none'}${dist.not_rated ? `; not rated ${dist.not_rated}` : ''}).` +
      (agencies.length ? ` ${a.min_stars ? `${rows.length} with ${a.min_stars}+ quality stars. ` : ''}Top by ${sort === 'patient_survey' ? 'patient survey' : sort}: ${top.join('; ')}.` : ` None has ${a.min_stars} or more quality stars.`);
  return {
    summary, as_of: asOf, source: SOURCE_HH, more: more(),
    query: { zip, city: a.city ?? null, state: st, name: a.name ?? null, services: a.services ?? [], min_stars: a.min_stars ?? null, sort },
    matched, quality_star_distribution: dist, shown: agencies.length, agencies,
    notes: [
      'Quality of patient care stars (1 to 5 in half stars) summarize how often patients got better, began care on time and avoided harm. Patient survey stars (1 to 5) come from the HHCAHPS survey of patients.',
      a.zip ? 'A ZIP search lists the agencies that report serving that ZIP code to Medicare; the agency office may be elsewhere.' : 'A city search matches the agency office location; search by ZIP code to find every agency that serves an address.',
      'Use home_health_ratings with a ccn for the quality measures, hospital use and spending against state and national averages.',
    ],
  };
}

export async function homeHealthRatings(f: FetchText, ref: Ref) {
  const { row, other_matches } = await resolve(f, 'hh', ref);
  const ccn = row.cms_certification_number_ccn, st = row.state;
  const opt = <T>(p: Promise<T>, d: T) => p.catch(() => d);
  const [sv, stRows, natRows, svState, svNat, zips, asOf, asOfSurvey] = await Promise.all([
    opt(query(f, DS.hhCahps, { conditions: [{ property: 'cms_certification_number_ccn', value: ccn }], limit: 5 }).then((x) => x.rows), [] as Row[]),
    opt(query(f, DS.hhState, { conditions: [{ property: 'state', value: st }], limit: 5 }).then((x) => x.rows), [] as Row[]),
    opt(query(f, DS.hhNation, { limit: 5 }).then((x) => x.rows), [] as Row[]),
    opt(query(f, DS.hhCahpsState, { conditions: [{ property: 'state', value: st }], limit: 5 }).then((x) => x.rows), [] as Row[]),
    opt(query(f, DS.hhCahpsNation, { limit: 5 }).then((x) => x.rows), [] as Row[]),
    zipCount(f, DS.hhZip, ccn), modified(f, DS.hh), modified(f, DS.hhCahps),
  ]);
  const S: Row = stRows[0] ?? {}, N: Row = natRows[0] ?? {};
  const b = hhBrief(row);
  const measures = HH_MEASURES.map(([id, name, col, fn, better]) => {
    const v = num(row[col]);
    return { id, name, value_pct: v, state_pct: num(S[col]), national_pct: num(N[col]), better, note: v === null ? (textNote(row[fn]) ?? 'Not available.') : null };
  });
  const claims = HH_CLAIMS.map(([p, id, name, better]) => {
    const v = num(row[`${p}_riskstandardized_rate`]);
    const cat = String(row[`${p}_performance_categorization`] ?? '').trim();
    return {
      id, name, risk_standardized_rate_pct: v, observed_rate_pct: num(row[`${p}_observed_rate`]), national_observed_rate_pct: num(N[`${p}_national_observed_rate`]),
      compared_with_national: cat && cat !== '-' && cat !== 'Not Available' ? cat : null, better,
      note: v === null ? (textNote(row[`footnote_for_${p}_riskstandardized_rate`]) ?? 'Not available.') : null,
    };
  });
  const s = sv[0];
  const pstar = num(s?.hhcahps_survey_summary_star_rating);
  const survey = s ? {
    summary_stars: pstar, summary_stars_note: codeNote(HH_FOOTNOTES, s.hhcahps_survey_summary_star_rating_footnote),
    topics: HH_SURVEY.map(([topic, sc, pc, fc]) => ({ topic, stars: num(s[sc]), pct: num(s[pc]), state_pct: num(svState[0]?.[pc]), national_pct: num(svNat[0]?.[pc]), note: codeNote(HH_FOOTNOTES, s[fc]) })),
    would_definitely_recommend_pct: num(s[HH_RECOMMEND]), state_recommend_pct: num(svState[0]?.[HH_RECOMMEND]), national_recommend_pct: num(svNat[0]?.[HH_RECOMMEND]),
    surveys_completed: num(s.number_of_completed_surveys), response_rate_pct: num(s.survey_response_rate),
  } : null;
  const spend = num(row[HH_SPEND]);
  const parts: string[] = [];
  parts.push(`${b.name} (${b.city}, ${st}, CCN ${ccn}, ${b.ownership}): ${b.quality_stars === null ? `no quality of patient care star rating (${b.quality_stars_note})` : `quality of patient care ${b.quality_stars} of 5 stars`}` +
    `${num(S.quality_of_patient_care_star_rating) !== null ? ` (${st} median ${num(S.quality_of_patient_care_star_rating)})` : ''}.`);
  if (survey) {
    parts.push(`Patient survey: ${survey.summary_stars === null ? `no star rating${survey.summary_stars_note ? ` (${survey.summary_stars_note})` : ''}` : `${survey.summary_stars} of 5 stars`}` +
      `${survey.topics[3].pct !== null ? `; ${survey.topics[3].pct}% rated it 9 or 10 (national ${survey.topics[3].national_pct ?? 'n/a'}%)` : ''}` +
      `${survey.would_definitely_recommend_pct !== null ? `; ${survey.would_definitely_recommend_pct}% would definitely recommend it (national ${survey.national_recommend_pct ?? 'n/a'}%)` : ''}.`);
  } else parts.push('No patient survey results.');
  const ts = measures[0];
  if (ts.value_pct !== null) parts.push(`Began care on time ${ts.value_pct}% (${st} ${ts.state_pct ?? 'n/a'}%, national ${ts.national_pct ?? 'n/a'}%).`);
  const cl = claims.filter((c) => c.compared_with_national).map((c) => `${c.id.replace(/_/g, ' ')}: ${(c.compared_with_national as string).toLowerCase()}`);
  if (cl.length) parts.push(`Against the national rate: ${cl.join('; ')}.`);
  if (spend !== null) parts.push(`Medicare spending per episode ${spend} times the national average.`);
  if (zips !== null) parts.push(`Serves ${zips} ZIP codes.`);
  return {
    summary: parts.join(' '),
    as_of: asOf, data_updated: { agencies: asOf, patient_survey: asOfSurvey }, source: SOURCE_HH, more: more(),
    agency: { ...b, zip_codes_served: zips },
    quality_of_patient_care: { stars: b.quality_stars, note: b.quality_stars_note, state_median_stars: num(S.quality_of_patient_care_star_rating), national_median_stars: num(N.quality_of_patient_care_star_rating) },
    patient_survey: survey,
    quality_measures: measures,
    hospital_use_and_discharge: claims,
    medicare_spending_per_episode: { ratio_to_national: spend, state_ratio: num(S[HH_SPEND_STATE]), episodes: num(row.no_of_episodes_to_calc_how_much_medicare_spends_per_episode_4f4e), note: spend === null ? textNote(row.footnote_for_how_much_medicare_spends_on_an_episode_of_care_5dfd) : null },
    other_matches,
    notes: [
      'Percentages are the share of the agency\'s patient episodes; "better" says whether a higher or lower value is better. State and national values are CMS averages for the same measure.',
      'CMS refreshes Care Compare home health data quarterly. Check the agency on medicare.gov/care-compare and ask it about Medicare and your insurance before choosing.',
    ],
  };
}

// ---------- hospice ----------

export const HOSPICE_SURVEY: [string, string][] = [
  ['TEAM_COMM_TBV', 'The hospice team always communicated well'], ['TIMELY_CARE_TBV', 'The hospice team always provided timely help'],
  ['RESPECT_TBV', 'The hospice team always treated the patient with respect'], ['EMO_REL_TBV', 'The right amount of emotional and spiritual support'],
  ['SYMPTOMS_TBV', 'The patient always got the help they needed for pain and symptoms'], ['RATING_TBV', 'Caregivers rated the hospice 9 or 10 out of 10'],
  ['RECOMMEND_TBV', 'Caregivers would definitely recommend the hospice'],
];
export const HOSPICE_QUALITY: [string, string, 'higher' | 'lower' | 'n/a'][] = [
  ['H_008_01', 'Patients who got an assessment of all 7 HIS measures at the beginning of hospice care (comprehensive assessment)', 'higher'],
  ['H_011_01', 'Patients who got visits from a registered nurse or medical social worker on at least 2 of the final 3 days of life', 'higher'],
  ['H_012_00', 'Hospice Care Index score (0 to 10 indicators met)', 'higher'],
];
export const HCI: [string, string, 'higher' | 'lower'][] = [
  ['H_012_01', 'Continuous home care or general inpatient care provided (% of days)', 'higher'],
  ['H_012_02', 'Gaps in skilled nursing visits of more than 7 days (% of elections)', 'lower'],
  ['H_012_03', 'Early live discharges (% of live discharges)', 'lower'],
  ['H_012_04', 'Late live discharges (% of live discharges)', 'lower'],
  ['H_012_05', 'Burdensome transitions type 1: live discharge then hospital, then hospice again (% of live discharges)', 'lower'],
  ['H_012_06', 'Burdensome transitions type 2: live discharge then hospital and death (% of live discharges)', 'lower'],
  ['H_012_07', 'Medicare spending per beneficiary (US dollars)', 'lower'],
  ['H_012_08', 'Nurse care minutes per routine home care day', 'higher'],
  ['H_012_09', 'Skilled nursing minutes on weekends (% of minutes)', 'higher'],
  ['H_012_10', 'Visits near death (% of decedents)', 'higher'],
];
export const DIAGNOSES: [string, string][] = [
  ['Pct_Pts_w_Cancer', 'cancer'], ['Pct_Pts_w_Dementia', 'dementia'], ['Pct_Pts_w_Stroke', 'stroke'],
  ['Pct_Pts_w_Circ_Heart_Disease', 'circulatory or heart disease'], ['Pct_Pts_w_Resp_Disease', 'respiratory disease'], ['Pct_Pts_w_other_conditions', 'other conditions'],
];
export const LOCATIONS: [string, string][] = [
  ['Care_Provided_Home', 'home'], ['Care_Provided_Assisted_Living', 'assisted living facility'], ['Care_Provided_Nursing_Facility', 'nursing facility'],
  ['Care_Provided_Skilled_Nursing', 'skilled nursing facility'], ['Care_Provided_Inpatient_Hospital', 'inpatient hospital'],
  ['Care_Provided_Inpatient_Hospice', 'inpatient hospice facility'], ['Care_Provided_other_locations', 'other locations'],
];

export function hospiceBrief(r: Row) {
  const a2 = String(r.address_line_2 ?? '').trim();
  return {
    ccn: r.cms_certification_number_ccn, name: titleCase(r.facility_name ?? ''),
    address: titleCase([r.address_line_1, a2 && a2 !== '-' ? a2 : ''].filter(Boolean).join(', ')),
    city: titleCase(r.citytown ?? ''), state: r.state, zip: r.zip_code, county: titleCase(r.countyparish ?? ''), phone: phone(r.telephone_number),
    ownership: r.ownership_type || null, certified_since: isoDate(r.certification_date),
    care_compare_url: `https://www.medicare.gov/care-compare/details/hospice/${r.cms_certification_number_ccn}`,
  };
}

interface Fam { stars: number | null; stars_note: string | null; rated_9_or_10_pct: number | null; would_definitely_recommend_pct: number | null }
function famOf(rows: Row[]): Fam {
  const by = new Map(rows.map((r) => [r.measure_code, r]));
  const s = by.get('SUMMARY_STAR_RATING');
  const st = num(s?.star_rating);
  return {
    stars: st, stars_note: s && st === null ? (codeNote(HOSPICE_FOOTNOTES, s.footnote) ?? 'No family caregiver star rating.') : (s ? null : 'No CAHPS Hospice Survey results.'),
    rated_9_or_10_pct: num(by.get('RATING_TBV')?.score), would_definitely_recommend_pct: num(by.get('RECOMMEND_TBV')?.score),
  };
}

export interface HospiceSearchArgs { zip?: string; city?: string; county?: string; state?: string; name?: string; min_stars?: number; sort?: 'family_rating' | 'care_index' | 'name'; limit?: number }

export async function hospiceSearch(f: FetchText, a: HospiceSearchArgs) {
  const st = a.state ? stateCode(a.state) : null;
  let rows: Row[];
  let where: string;
  let zip: string | null = null;
  if (a.zip) {
    zip = zip5(a.zip);
    const served = await queryAll(f, DS.hospiceZip, { conditions: [{ property: 'zip_code', value: zip }] });
    const ccns = served.map((r) => r.cms_certification_number_ccn);
    rows = ccns.length ? await queryIn(f, DS.hospice, 'cms_certification_number_ccn', ccns) : [];
    if (st) rows = rows.filter((r) => r.state === st);
    where = `serving ZIP ${zip}`;
  } else {
    const conds: Cond[] = [];
    if (st) conds.push({ property: 'state', value: st });
    if (a.city) conds.push({ property: 'citytown', value: String(a.city).trim().toUpperCase().replace(/^ST\.? /, 'SAINT ') });
    if (a.county) {
      if (!st) throw new InputError('A county search needs a state too.');
      conds.push({ property: 'countyparish', value: String(a.county).trim().toUpperCase().replace(/\s+(COUNTY|PARISH|BOROUGH)$/, '') });
    }
    if (a.name) conds.push({ property: 'facility_name', value: `%${likeToken(a.name)}%`, operator: 'like' });
    if (!conds.length) throw new InputError('Give a ZIP code (hospices that serve it), or a state, city, county or hospice name.');
    rows = await queryAll(f, DS.hospice, { conditions: conds });
    where = [a.name && `named like "${a.name}"`, a.city && `with an office in ${titleCase(String(a.city))}`, a.county && `in ${titleCase(String(a.county))} County`, st && `in ${STATES[st]}`].filter(Boolean).join(' ');
  }
  if (a.name) rows = rows.filter((r) => scoreName(a.name as string, r.facility_name) >= 0.5);
  const ccns = rows.map((r) => r.cms_certification_number_ccn);
  // Family survey rows and the Hospice Care Index: read by state when the search is a whole state, otherwise by CCN.
  const fam = new Map<string, Row[]>(); const hci = new Map<string, number | null>();
  if (ccns.length) {
    const codes = ['SUMMARY_STAR_RATING', 'RATING_TBV', 'RECOMMEND_TBV'];
    const cProps = ['cms_certification_number_ccn', 'measure_code', 'score', 'star_rating', 'footnote'];
    const wholeState = !a.zip && !a.city && !a.county && !a.name && st;
    const [cRows, hRows] = await Promise.all([
      (wholeState ? queryAll(f, DS.hospiceCahps, { conditions: [{ property: 'state', value: st as string }, { property: 'measure_code', value: codes, operator: 'in' }], properties: cProps })
        : queryIn(f, DS.hospiceCahps, 'cms_certification_number_ccn', ccns, [{ property: 'measure_code', value: codes, operator: 'in' }], cProps)).catch(() => [] as Row[]),
      (wholeState ? queryAll(f, DS.hospiceMeasures, { conditions: [{ property: 'state', value: st as string }, { property: 'measure_code', value: 'H_012_00_OBSERVED' }], properties: ['cms_certification_number_ccn', 'score'] })
        : queryIn(f, DS.hospiceMeasures, 'cms_certification_number_ccn', ccns, [{ property: 'measure_code', value: 'H_012_00_OBSERVED' }], ['cms_certification_number_ccn', 'score'])).catch(() => [] as Row[]),
    ]);
    for (const r of cRows) { const l = fam.get(r.cms_certification_number_ccn) ?? []; l.push(r); fam.set(r.cms_certification_number_ccn, l); }
    for (const r of hRows) hci.set(r.cms_certification_number_ccn, num(r.score));
  }
  const list = rows.map((r) => ({ ...hospiceBrief(r), family: famOf(fam.get(r.cms_certification_number_ccn) ?? []), hci: hci.get(r.cms_certification_number_ccn) ?? null }));
  const dist: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0, not_rated: 0 };
  for (const h of list) dist[h.family.stars === null ? 'not_rated' : String(h.family.stars)]++;
  const matched = list.length;
  let cand = a.min_stars ? list.filter((h) => (h.family.stars ?? 0) >= (a.min_stars as number)) : list;
  const sort = a.sort ?? 'family_rating';
  const byName = (x: typeof list[number], y: typeof list[number]) => x.name.localeCompare(y.name);
  const fs = (h: typeof list[number]) => h.family.stars ?? -1;
  const rec = (h: typeof list[number]) => h.family.would_definitely_recommend_pct ?? -1;
  cand = cand.slice().sort(sort === 'name' ? byName
    : sort === 'care_index' ? (x, y) => (y.hci ?? -1) - (x.hci ?? -1) || fs(y) - fs(x) || rec(y) - rec(x) || byName(x, y)
      : (x, y) => fs(y) - fs(x) || rec(y) - rec(x) || (y.hci ?? -1) - (x.hci ?? -1) || byName(x, y));
  const limit = Math.min(Math.max(a.limit ?? 15, 1), 50);
  const hospices = cand.slice(0, limit).map((h) => ({
    ccn: h.ccn, name: h.name, address: h.address, city: h.city, state: h.state, zip: h.zip, county: h.county, phone: h.phone, ownership: h.ownership,
    certified_since: h.certified_since, family_survey_stars: h.family.stars, family_survey_note: h.family.stars_note,
    rated_9_or_10_pct: h.family.rated_9_or_10_pct, would_definitely_recommend_pct: h.family.would_definitely_recommend_pct,
    hospice_care_index: h.hci, care_compare_url: h.care_compare_url,
  }));
  const asOf = await modified(f, DS.hospice);
  const top = hospices.slice(0, 5).map((h) => `${h.name} (${h.city}, ${h.state}): family survey ${stars(h.family_survey_stars)}` +
    `${h.would_definitely_recommend_pct !== null ? `, ${h.would_definitely_recommend_pct}% would definitely recommend` : ''}${h.hospice_care_index !== null ? `, care index ${h.hospice_care_index}/10` : ''}`);
  const summary = matched === 0
    ? `No Medicare-certified hospices ${where}.`
    : `${matched} Medicare-certified hospice${matched === 1 ? '' : 's'} ${where} (family caregiver survey stars: 5: ${dist['5']}, 4: ${dist['4']}, 3: ${dist['3']}, 2: ${dist['2']}, 1: ${dist['1']}, not rated ${dist.not_rated}).` +
      (hospices.length ? ` ${a.min_stars ? `${cand.length} with ${a.min_stars}+ stars. ` : ''}Top by ${sort.replace('_', ' ')}: ${top.join('; ')}.` : ` None has ${a.min_stars} or more stars.`);
  return {
    summary, as_of: asOf, source: SOURCE_HOSPICE, more: more(),
    query: { zip, city: a.city ?? null, county: a.county ?? null, state: st, name: a.name ?? null, min_stars: a.min_stars ?? null, sort },
    matched, family_survey_star_distribution: dist, shown: hospices.length, hospices,
    notes: [
      'Family survey stars (1 to 5) summarize the CAHPS Hospice Survey answered by family caregivers after the patient died. Smaller hospices often have too few surveys for a star rating.',
      'hospice_care_index is the CMS Hospice Care Index: how many of 10 claims-based indicators the hospice met (0 to 10, higher is better).',
      a.zip ? 'A ZIP search lists the hospices that report serving that ZIP code to Medicare; the office may be elsewhere.' : 'A city search matches the hospice office location; search by ZIP code to find every hospice that serves an address.',
    ],
  };
}

export async function hospiceRatings(f: FetchText, ref: Ref) {
  const { row, other_matches } = await resolve(f, 'hospice', ref);
  const ccn = row.cms_certification_number_ccn, st = row.state;
  const opt = <T>(p: Promise<T>, d: T) => p.catch(() => d);
  const ccnCond = [{ property: 'cms_certification_number_ccn', value: ccn }];
  const [m, c, sm, nm, sc, nc, zips, asOf, asOfSurvey] = await Promise.all([
    opt(query(f, DS.hospiceMeasures, { conditions: ccnCond, limit: 200 }).then((x) => x.rows), [] as Row[]),
    opt(query(f, DS.hospiceCahps, { conditions: ccnCond, limit: 100 }).then((x) => x.rows), [] as Row[]),
    opt(query(f, DS.hospiceState, { conditions: [{ property: 'state', value: st }], limit: 100 }).then((x) => x.rows), [] as Row[]),
    opt(query(f, DS.hospiceNation, { limit: 100 }).then((x) => x.rows), [] as Row[]),
    opt(query(f, DS.hospiceCahpsState, { conditions: [{ property: 'state', value: st }], limit: 100 }).then((x) => x.rows), [] as Row[]),
    opt(query(f, DS.hospiceCahpsNation, { limit: 100 }).then((x) => x.rows), [] as Row[]),
    zipCount(f, DS.hospiceZip, ccn), modified(f, DS.hospiceMeasures), modified(f, DS.hospiceCahps),
  ]);
  const b = hospiceBrief(row);
  const M = new Map(m.map((r) => [r.measure_code, r]));
  const val = (map: Map<string, Row>, code: string) => num(map.get(code)?.score);
  const SM = new Map(sm.map((r) => [r.measure_code, r])), NM = new Map(nm.map((r) => [r.measure_code, r]));
  const C = new Map(c.map((r) => [r.measure_code, r])), SC = new Map(sc.map((r) => [r.measure_code, r])), NC = new Map(nc.map((r) => [r.measure_code, r]));
  const fam = famOf(c);
  const cahpsPeriod = period(C.get('SUMMARY_STAR_RATING')?.date);
  const familySurvey = c.length ? {
    stars: fam.stars, stars_note: fam.stars_note, period: cahpsPeriod,
    topics: HOSPICE_SURVEY.map(([code, topic]) => {
      const r = C.get(code);
      const v = num(r?.score);
      return { topic, pct: v, state_pct: val(SC, code), national_pct: val(NC, code), note: v === null ? (codeNote(HOSPICE_FOOTNOTES, r?.footnote) ?? 'Not available.') : null };
    }),
  } : null;
  const obs = (code: string) => {
    const r = M.get(`${code}_OBSERVED`);
    const v = num(r?.score);
    return { value: v, state: val(SM, `${code}_OBSERVED`), national: val(NM, `${code}_OBSERVED`), period: period(r?.measure_date_range), note: v === null ? (r ? codeNote(HOSPICE_FOOTNOTES, r.footnote) ?? 'Not available.' : 'Not reported.') : null };
  };
  const quality = HOSPICE_QUALITY.map(([code, name, better]) => ({ id: code, name, better, ...obs(code) }));
  const hciIndicators = HCI.map(([code, name, better]) => ({ id: code, name, better, ...obs(code), percentile: num(M.get(`${code}_PERCENTILE`)?.score) }));
  const pctList = (list: [string, string][]) => list.map(([code, label]) => {
    const r = M.get(code);
    return r ? { label, pct: num(r.score), note: codeNote(HOSPICE_FOOTNOTES, r.footnote) } : null;
  }).filter((x): x is { label: string; pct: number | null; note: string | null } => x !== null);
  const yes = (code: string) => { const v = String(M.get(code)?.score ?? '').trim(); return v === 'Yes' ? true : v === 'No' ? false : null; };
  const profile = {
    average_daily_census: num(M.get('Average_Daily_Census')?.score),
    provided_routine_home_care_only: yes('Provided_Home_Care_only'),
    provided_routine_home_care_and_other_levels: yes('Provided_Home_Care_and_other'),
    served_medicare_advantage_patients: yes('Bene_MA_Pct'), served_dual_eligible_patients: yes('Bene_Dual_Pct'),
    diagnoses_pct: pctList(DIAGNOSES), care_locations_pct: pctList(LOCATIONS),
    period: period(M.get('Average_Daily_Census')?.measure_date_range),
  };
  const hciScore = quality[2];
  const parts: string[] = [];
  parts.push(`${b.name} (${b.city}, ${st}, CCN ${ccn}, ${b.ownership ?? 'ownership not listed'}): family caregiver survey ${fam.stars === null ? `not star rated (${fam.stars_note})` : `${fam.stars} of 5 stars`}.`);
  const rt = familySurvey?.topics.find((t) => t.topic.startsWith('Caregivers rated'));
  const rc = familySurvey?.topics.find((t) => t.topic.startsWith('Caregivers would'));
  if (rt && rt.pct !== null) parts.push(`${rt.pct}% of family caregivers rated it 9 or 10 (${st} ${rt.state_pct ?? 'n/a'}%, national ${rt.national_pct ?? 'n/a'}%)` + (rc && rc.pct !== null ? `; ${rc.pct}% would definitely recommend it (national ${rc.national_pct ?? 'n/a'}%).` : '.'));
  if (hciScore.value !== null) parts.push(`Hospice Care Index ${hciScore.value} of 10 (national ${hciScore.national ?? 'n/a'}).`);
  const v = quality[1];
  if (v.value !== null) parts.push(`Nurse or social worker visits in the last days of life ${v.value}% (national ${v.national ?? 'n/a'}%).`);
  if (profile.average_daily_census !== null) parts.push(`Average daily census ${profile.average_daily_census}.`);
  if (zips !== null) parts.push(`Serves ${zips} ZIP codes.`);
  return {
    summary: parts.join(' '),
    as_of: asOf, data_updated: { measures: asOf, family_survey: asOfSurvey }, source: SOURCE_HOSPICE, more: more(),
    hospice: { ...b, zip_codes_served: zips },
    family_caregiver_survey: familySurvey,
    quality_measures: quality,
    hospice_care_index_indicators: hciIndicators,
    profile,
    other_matches,
    notes: [
      'Family caregiver survey (CAHPS Hospice Survey) percentages are the share of caregivers giving the best answer; state and national values are CMS averages.',
      'Hospice Care Index indicators come from Medicare claims; percentile is the hospice\'s national percentile on that indicator.',
      'CMS refreshes Care Compare hospice data quarterly. Ask the hospice about Medicare coverage, staffing and after-hours visits before choosing.',
    ],
  };
}
