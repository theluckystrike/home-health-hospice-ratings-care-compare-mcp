// Fixtures in test/fixtures/ were downloaded 2026-11-17T15:06Z from the data.cms.gov Provider Data Catalog datastore API
// (~/mcp-servers-work/s1117w4/hh/fixtures.py): every Vermont home health agency (6jpm-sxkc, modified 2026-09-21) plus one
// unrated Texas agency (453112), their HHCAHPS rows (ccn4-8vby), the ZIP-served rows for 05401 and 05602 (m5eg-upu5, 95rg-2usp),
// the VT and national averages, every Vermont hospice (yc9t-dgbk), the CAHPS Hospice rows (all 22 for 471500 and 471510, and the
// star, rating and recommend rows for the other seven), the Provider Data rows of 471500 and 471510 and the Hospice Care Index
// row of every VT hospice (252m-zfp9), and metastore entries. Expected values were computed separately in Python
// (~/mcp-servers-work/s1117w4/hh/expect.py) from the same files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  queryUrl, queryAll, query, homeHealthSearch, homeHealthRatings, hospiceSearch, hospiceRatings, stateCode, zip5, num, period,
  codeNote, HH_FOOTNOTES, HOSPICE_FOOTNOTES, InputError, UpstreamError, UTM, DS,
} from '../dist/core.js';

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const TABLES = {
  [DS.hh]: load('hh_agencies'), [DS.hhCahps]: load('hh_cahps'), [DS.hhZip]: load('hh_zip'), [DS.hhState]: load('hh_state'),
  [DS.hhNation]: load('hh_nation'), [DS.hhCahpsState]: load('hh_cahps_state'), [DS.hhCahpsNation]: load('hh_cahps_nation'),
  [DS.hospice]: load('hospice_general'), [DS.hospiceMeasures]: load('hospice_measures'), [DS.hospiceCahps]: load('hospice_cahps'),
  [DS.hospiceZip]: load('hospice_zip'), [DS.hospiceState]: load('hospice_state'), [DS.hospiceNation]: load('hospice_nation'),
  [DS.hospiceCahpsState]: load('hospice_cahps_state'), [DS.hospiceCahpsNation]: load('hospice_cahps_nation'),
};
const META = load('metastore');

// A small emulator of the DKAN datastore query API: conditions with =, like and in (text, case-insensitive), properties, limit,
// offset and count, plus the metastore item endpoint.
function emulator(tables, seen = []) {
  return async (u) => {
    seen.push(u);
    const mm = /^https:\/\/data\.cms\.gov\/provider-data\/api\/1\/metastore\/schemas\/dataset\/items\/([a-z0-9-]+)$/.exec(u);
    if (mm) { if (!META[mm[1]]) throw new Error('HTTP 404'); return JSON.stringify(META[mm[1]]); }
    const m = /^https:\/\/data\.cms\.gov\/provider-data\/api\/1\/datastore\/query\/([a-z0-9-]+)\/0\?(.*)$/.exec(u);
    if (!m || !tables[m[1]]) throw new Error(`HTTP 404 (no fixture for ${u})`);
    const conds = []; const props = []; let limit = 100; let offset = 0;
    for (const kv of m[2].split('&')) {
      const [k, v0] = kv.split('='); const v = decodeURIComponent(v0 ?? '');
      let b;
      if (k === 'limit') limit = Number(v);
      else if (k === 'offset') offset = Number(v);
      else if (k === 'properties[]') props.push(v);
      else if ((b = /^conditions\[(\d+)\]\[(property|operator)\]$/.exec(k))) (conds[b[1]] ??= { value: [] })[b[2]] = v;
      else if ((b = /^conditions\[(\d+)\]\[value\](?:\[(\d+)\])?$/.exec(k))) { const c = (conds[b[1]] ??= { value: [] }); if (b[2] === undefined) c.single = v; else c.value[Number(b[2])] = v; }
      else assert.ok(['schema', 'results'].includes(k), `unexpected parameter ${k}`);
    }
    assert.ok(limit <= 1500, 'limit above the API maximum of 1500');
    const lc = (s) => String(s ?? '').toLowerCase();
    const match = (r, c) => {
      const x = lc(r[c.property]); const op = lc(c.operator ?? '=');
      if (op === '=') return x === lc(c.single);
      if (op === 'like') return new RegExp('^' + lc(c.single).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$').test(x);
      if (op === 'in') return c.value.map(lc).includes(x);
      throw new Error(`operator ${op}`);
    };
    const rows = tables[m[1]].filter((r) => conds.every((c) => match(r, c)));
    const page = rows.slice(offset, offset + limit).map((r) => (props.length ? Object.fromEntries(props.map((p) => [p, r[p]])) : r));
    return JSON.stringify({ results: page, count: rows.length });
  };
}
const seen = [];
const f = emulator(TABLES, seen);

test('query URLs, values, footnotes and input checks', () => {
  assert.equal(queryUrl(DS.hhZip, { conditions: [{ property: 'zip_code', value: '05401' }], properties: ['cms_certification_number_ccn'] }),
    'https://data.cms.gov/provider-data/api/1/datastore/query/m5eg-upu5/0?limit=1500&properties[]=cms_certification_number_ccn' +
    '&conditions[0][property]=zip_code&conditions[0][value]=05401&conditions[0][operator]=%3D&schema=false&results=true');
  assert.match(queryUrl(DS.hh, { conditions: [{ property: 'cms_certification_number_ccn', value: ['477000', '477003'] }], limit: 5, offset: 1500 }),
    /limit=5&offset=1500&conditions\[0\]\[property\]=cms_certification_number_ccn&conditions\[0\]\[value\]\[0\]=477000&conditions\[0\]\[value\]\[1\]=477003&conditions\[0\]\[operator\]=in/);
  assert.equal(num('3,213'), 3213); assert.equal(num('66.0%'), 66); assert.equal(num('$13,204'), 13204); assert.equal(num('-'), null); assert.equal(num('Not Available'), null);
  assert.equal(period('10/01/2023-09/30/2025'), '2023-10-01 to 2025-09-30'); assert.equal(period('01/01/2023 - 12/31/2024'), '2023-01-01 to 2024-12-31');
  assert.match(codeNote(HH_FOOTNOTES, '10,11'), /less than 12 months.*Fewer than 70 patients/);
  assert.match(codeNote(HOSPICE_FOOTNOTES, '15'), /too small to report Star Ratings/);
  assert.equal(codeNote(HOSPICE_FOOTNOTES, '-'), null); assert.match(codeNote(HOSPICE_FOOTNOTES, '99'), /CMS footnote 99/);
  assert.equal(stateCode('vermont'), 'VT'); assert.throws(() => stateCode('Vermontia'), InputError);
  assert.equal(zip5('5401'), '05401'); assert.equal(zip5('05401-1234'), '05401'); assert.throws(() => zip5('ABC'), InputError);
});

test('queryAll pages past the 1500-row limit; a data.cms.gov 403 is retried once', async () => {
  const big = Array.from({ length: 3200 }, (_, i) => ({ state: 'TX', cms_certification_number_ccn: String(450000 + i) }));
  const urls = [];
  const rows = await queryAll(emulator({ [DS.hh]: big }, urls), DS.hh, { conditions: [{ property: 'state', value: 'TX' }] });
  assert.equal(rows.length, 3200);
  assert.equal(new Set(rows.map((r) => r.cms_certification_number_ccn)).size, 3200);
  assert.deepEqual(urls.map((u) => /offset=(\d+)/.exec(u)?.[1] ?? '0'), ['0', '1500', '3000']);
  let n = 0;
  const flaky = async (u) => { if (n++ === 0) throw new Error('HTTP 403'); return f(u); };
  const r = await query(flaky, DS.hhNation, {});
  assert.equal(r.rows.length, 1); assert.equal(n, 2);
  await assert.rejects(query(async () => { throw new Error('HTTP 500'); }, DS.hh, {}), UpstreamError);
  await assert.rejects(query(async () => '<html>', DS.hh, {}), UpstreamError);
});

test('home health search by ZIP 05401: the 3 agencies that serve it, best quality stars first', async () => {
  const r = await homeHealthSearch(f, { zip: '05401' });
  assert.deepEqual(r.agencies.map((a) => [a.ccn, a.quality_stars, a.patient_survey_stars]), [['477019', 3.5, 3], ['477007', 3, 3], ['477000', 2.5, 4]]);
  assert.equal(r.matched, 3); assert.equal(r.as_of, '2026-09-21');
  assert.match(r.summary, /^3 Medicare-certified home health agencies serving ZIP 05401/);
  assert.match(r.summary, /\(quality star ratings 3\.5: 1, 3: 1, 2\.5: 1\)/);
  assert.equal(r.agencies[0].name, 'Bayada Home Health Care, Inc.');
  assert.equal(r.agencies[2].name, 'UVMHN Home Health and Hospice'); assert.equal(r.agencies[2].phone.length, 14);
  assert.equal(r.agencies[2].rated_9_or_10_pct, 87); assert.equal(r.agencies[2].would_definitely_recommend_pct, 88);
  assert.equal(r.agencies[0].care_compare_url, 'https://www.medicare.gov/care-compare/details/home-health/477019');
  assert.ok(r.agencies[0].services.includes('nursing'));
  const ps = await homeHealthSearch(f, { zip: '05401', sort: 'patient_survey' });
  assert.equal(ps.agencies[0].ccn, '477000');
  assert.ok(r.more.includes(UTM));
});

test('home health search for Vermont: 9 agencies, distribution, order, min_stars; an unrated Texas agency carries its footnote', async () => {
  const r = await homeHealthSearch(f, { state: 'Vermont' });
  assert.equal(r.matched, 9);
  assert.deepEqual(r.agencies.map((a) => a.ccn), ['477010', '477003', '477018', '477019', '477014', '477007', '477002', '477015', '477000']);
  assert.equal(r.quality_star_distribution['3.5'], 4); assert.equal(r.quality_star_distribution['3'], 3); assert.equal(r.quality_star_distribution['2.5'], 2);
  const m = await homeHealthSearch(f, { state: 'VT', min_stars: 3.5, limit: 2 });
  assert.equal(m.shown, 2); assert.match(m.summary, /4 with 3\.5\+ quality stars/);
  const tx = await homeHealthSearch(f, { state: 'TX' });
  assert.equal(tx.agencies[0].quality_stars, null);
  assert.equal(tx.agencies[0].quality_stars_note, 'The number of patient episodes for this measure is too small to report.');
  const named = await homeHealthSearch(f, { name: 'Central Vermont Home Health', state: 'VT' });
  assert.deepEqual(named.agencies.map((a) => a.ccn), ['477003']);
  await assert.rejects(homeHealthSearch(f, {}), InputError);
  await assert.rejects(homeHealthSearch(f, { zip: '05401', services: ['massage'] }), InputError);
  const none = await homeHealthSearch(f, { zip: '99999' });
  assert.equal(none.matched, 0); assert.match(none.summary, /^No Medicare-certified home health agencies serving ZIP 99999/);
});

test('home health ratings for 477000 against the VT and national averages', async () => {
  const r = await homeHealthRatings(f, { ccn: '477000' });
  assert.equal(r.quality_of_patient_care.stars, 2.5); assert.equal(r.quality_of_patient_care.state_median_stars, 3);
  const ts = r.quality_measures.find((m) => m.id === 'timely_start');
  assert.deepEqual([ts.value_pct, ts.state_pct, ts.national_pct], [72.72, 93.23, 96.59]);
  const falls = r.quality_measures.find((m) => m.id === 'falls_major_injury');
  assert.deepEqual([falls.value_pct, falls.state_pct, falls.national_pct, falls.better], [0.55, 1.18, 0.93, 'lower']);
  const dtc = r.hospital_use_and_discharge.find((c) => c.id === 'discharged_to_community');
  assert.deepEqual([dtc.risk_standardized_rate_pct, dtc.compared_with_national, dtc.national_observed_rate_pct], [89.5, 'Better Than National Rate', 78.03]);
  assert.deepEqual([r.medicare_spending_per_episode.ratio_to_national, r.medicare_spending_per_episode.state_ratio, r.medicare_spending_per_episode.episodes], [0.9, 1, 3213]);
  assert.equal(r.patient_survey.summary_stars, 4);
  assert.deepEqual([r.patient_survey.topics[3].pct, r.patient_survey.topics[3].national_pct], [87, 85]);
  assert.deepEqual([r.patient_survey.would_definitely_recommend_pct, r.patient_survey.state_recommend_pct, r.patient_survey.national_recommend_pct], [88, 86, 79]);
  assert.deepEqual([r.patient_survey.surveys_completed, r.patient_survey.response_rate_pct], [410, 26]);
  assert.equal(r.agency.zip_codes_served, 1); // only the 05401 and 05602 ZIP rows are in the fixture
  assert.match(r.summary, /quality of patient care 2\.5 of 5 stars \(VT median 3\)/);
  assert.match(r.summary, /Began care on time 72\.72% \(VT 93\.23%, national 96\.59%\)/);
  assert.equal(r.data_updated.patient_survey, '2026-09-16');
  const byName = await homeHealthRatings(f, { name: 'Central Vermont Home Health', state: 'VT' });
  assert.equal(byName.agency.ccn, '477003');
  await assert.rejects(homeHealthRatings(f, { ccn: '12' }), InputError);
  await assert.rejects(homeHealthRatings(f, { ccn: '999999' }), /No CMS-certified home health agency has CCN 999999/);
  await assert.rejects(homeHealthRatings(f, { name: 'Nonexistent Agency Zzzz', state: 'VT' }), InputError);
});

test('hospice search by ZIP 05401 and for all of Vermont, by family survey stars then would-recommend', async () => {
  const z = await hospiceSearch(f, { zip: '05401' });
  assert.deepEqual(z.hospices.map((h) => [h.ccn, h.family_survey_stars, h.would_definitely_recommend_pct, h.hospice_care_index]),
    [['471508', 5, 97, 10], ['471500', 5, 96, 9], ['471510', 4, 88, 10]]);
  assert.match(z.summary, /^3 Medicare-certified hospices serving ZIP 05401/);
  const vt = await hospiceSearch(f, { state: 'VT' });
  assert.deepEqual(vt.hospices.map((h) => h.ccn), ['471508', '471500', '471502', '471510', '471505', '471506', '471507', '471503', '471504']);
  assert.deepEqual(vt.family_survey_star_distribution, { '5': 2, '4': 3, '3': 2, '2': 0, '1': 0, not_rated: 2 });
  const nr = vt.hospices.find((h) => h.ccn === '471503');
  assert.equal(nr.family_survey_stars, null); assert.match(nr.family_survey_note, /too small to report Star Ratings/);
  assert.ok(seen.some((u) => u.includes('datastore/query/gxki-hrr8/0?') && u.includes('conditions[0][property]=state&conditions[0][value]=VT')));
  const ci = await hospiceSearch(f, { state: 'VT', sort: 'care_index' });
  assert.deepEqual(ci.hospices.map((h) => h.ccn), ['471508', '471502', '471510', '471505', '471507', '471500', '471506', '471503', '471504']);
  const four = await hospiceSearch(f, { state: 'VT', min_stars: 4 });
  assert.equal(four.shown, 5);
  await assert.rejects(hospiceSearch(f, { county: 'Chittenden' }), /needs a state/);
});

test('hospice ratings for 471500: family survey, quality, Hospice Care Index indicators and profile against VT and national', async () => {
  const r = await hospiceRatings(f, { ccn: '471500' });
  assert.equal(r.family_caregiver_survey.stars, 5); assert.equal(r.family_caregiver_survey.period, '2023-10-01 to 2025-09-30');
  const t = (p) => r.family_caregiver_survey.topics.find((x) => x.topic.startsWith(p));
  assert.deepEqual([t('Caregivers rated').pct, t('Caregivers rated').state_pct, t('Caregivers rated').national_pct], [92, 84, 83]);
  assert.deepEqual([t('Caregivers would').pct, t('Caregivers would').state_pct, t('Caregivers would').national_pct], [96, 90, 85]);
  assert.deepEqual([t('The hospice team always communicated').pct, t('The hospice team always communicated').national_pct], [90, 82]);
  const q = (id) => r.quality_measures.find((x) => x.id === id);
  assert.deepEqual([q('H_008_01').value, q('H_008_01').state, q('H_008_01').national], [99.59, 95.61, 96.15]);
  assert.deepEqual([q('H_011_01').value, q('H_011_01').state, q('H_011_01').national], [79.1, 66, 48.3]);
  assert.deepEqual([q('H_012_00').value, q('H_012_00').state, q('H_012_00').national], [9, 9.4, 8.8]);
  const h = (id) => r.hospice_care_index_indicators.find((x) => x.id === id);
  assert.deepEqual([h('H_012_08').value, h('H_012_08').national, h('H_012_08').percentile], [23.7, 19.9, 98]);
  assert.deepEqual([h('H_012_07').value, h('H_012_07').state, h('H_012_07').national, h('H_012_07').percentile], [10709, 13204, 19227, 13]);
  assert.equal(r.profile.average_daily_census, 88); assert.equal(r.profile.provided_routine_home_care_only, false);
  const nf = r.profile.care_locations_pct.find((x) => x.label === 'nursing facility');
  assert.equal(nf.pct, 0); assert.match(nf.note, /does not mean a hospice has not provided care/);
  assert.equal(r.profile.care_locations_pct.find((x) => x.label === 'home').pct, 64);
  assert.match(r.summary, /family caregiver survey 5 of 5 stars/);
  assert.match(r.summary, /92% of family caregivers rated it 9 or 10 \(VT 84%, national 83%\); 96% would definitely recommend it \(national 85%\)/);
  assert.match(r.summary, /Hospice Care Index 9 of 10 \(national 8\.8\)/);
  assert.equal(r.as_of, '2026-08-07');
  const b = await hospiceRatings(f, { name: 'Bayada', state: 'VT' });
  assert.equal(b.hospice.ccn, '471510');
  const nr = await hospiceRatings(f, { ccn: '471503' });
  assert.equal(nr.family_caregiver_survey.stars, null); assert.match(nr.summary, /not star rated \(The number of cases is too small to report Star Ratings\.\)/);
});

test('stdio: initialize, tools/list with annotations and a tools/call error over JSON-RPC (offline)', async () => {
  const child = spawn(process.execPath, [new URL('../dist/stdio.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = []; let buf = '';
  const got = (id) => new Promise((res) => { const iv = setInterval(() => { const m = lines.find((l) => l.id === id); if (m) { clearInterval(iv); res(m); } }, 10); });
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal((await got(1)).result.serverInfo.name, 'home-health-hospice-ratings-care-compare-mcp');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  const tools = (await got(2)).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['home_health_search', 'home_health_ratings', 'hospice_search', 'hospice_ratings']);
  for (const t of tools) { assert.ok(t.title); assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.destructiveHint, false); assert.equal(t.annotations.openWorldHint, true); }
  send({ id: 3, method: 'tools/call', params: { name: 'home_health_search', arguments: { state: 'Narnia' } } });
  const r3 = await got(3);
  child.kill();
  assert.equal(r3.result?.isError ?? Boolean(r3.error), true);
});
