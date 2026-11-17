// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, REPO, SITE, homeHealthRatings, homeHealthSearch, hospiceRatings, hospiceSearch } from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const META = {
  alias: 'home-health-hospice',
  metaDescription: 'MCP server for home health and hospice ratings: Medicare Care Compare quality star ratings, patient and family caregiver survey stars, quality measures and the Hospice Care Index for every Medicare-certified home health agency and hospice, searchable by the ZIP code they serve.',
  intro: 'Home health agency and hospice ratings for AI assistants: the Medicare Care Compare star ratings, patient and family survey results and quality measures for every certified agency, read live from the data CMS publishes on data.cms.gov.',
};

export const TOOL_INFO = [
  { name: 'home_health_search', blurb: 'Home health agencies that serve a ZIP code (or in a state or city, or by name) with their quality of patient care stars, patient survey stars and services, best rated first.' },
  { name: 'home_health_ratings', blurb: 'One home health agency in full: quality star rating, patient survey stars by topic, timely start of care, patient improvement, falls, hospital use and Medicare spending against state and national averages.' },
  { name: 'hospice_search', blurb: 'Hospices that serve a ZIP code (or in a state, city or county, or by name) with their family caregiver survey stars, share who would recommend them and Hospice Care Index, best rated first.' },
  { name: 'hospice_ratings', blurb: 'One hospice in full: family caregiver survey stars and topics, visits in the last days of life, the Hospice Care Index and its 10 indicators, patient mix and care settings against state and national averages.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream data.cms.gov error'}: ${msg}` }] };
}
const wrap = <A>(fn: (a: A) => unknown) => async (a: A) => { try { return ok((await fn(a)) as any); } catch (e) { return fail(e); } };

const ref = {
  ccn: z.string().optional().describe('CMS certification number (6 characters, from the search tool). Preferred when known.'),
  name: z.string().optional().describe('Agency name or part of it, used when no ccn is given.'),
  state: z.string().optional().describe('State name or two-letter code, to narrow a name lookup.'),
  city: z.string().optional().describe('City of the agency office, to narrow a name lookup.'),
};

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'Medicare Care Compare ratings for home health agencies and hospices, read at call time from the CMS Provider Data Catalog (refreshed quarterly). ' +
      'A model cannot know current star ratings or survey results. For "home health agencies near me" or "best home health care in <ZIP>" use home_health_search with zip; ' +
      'for one agency use home_health_ratings. For hospice questions use hospice_search and hospice_ratings. Remind the user to confirm Medicare or insurance coverage with the agency.',
  });

  server.registerTool('home_health_search', {
    title: 'Find and rank home health agencies',
    description:
      'Find Medicare-certified home health agencies that serve a ZIP code (as reported to Medicare), or that have an office in a state or city, or by name, ranked by the CMS quality of patient care star rating ' +
      '(1 to 5 in half stars), patient survey (HHCAHPS) stars or name. Each result has both star ratings, the share of patients rating it 9 or 10 and who would recommend it, services offered ' +
      '(nursing, physical, occupational and speech therapy, medical social services, home health aide), ownership, phone and the ccn for home_health_ratings.',
    inputSchema: {
      zip: z.string().optional().describe('5-digit ZIP code of the patient\'s home: lists every agency that serves it. Best for "near me" questions.'),
      state: z.string().optional().describe('State name or two-letter code (all agencies in the state, or narrows a ZIP or city search).'),
      city: z.string().optional().describe('City of the agency office (needs no ZIP).'),
      name: z.string().optional().describe('Agency name or part of it.'),
      services: z.array(z.enum(['nursing', 'physical_therapy', 'occupational_therapy', 'speech_therapy', 'medical_social_services', 'home_health_aide'])).optional().describe('Only agencies offering all of these services.'),
      min_stars: z.number().min(1).max(5).optional().describe('Minimum quality of patient care star rating (half stars allowed).'),
      sort: z.enum(['quality', 'patient_survey', 'name']).optional().describe('quality (default), patient_survey or name.'),
      limit: z.number().int().min(1).max(50).optional().describe('How many agencies to return. Default 15.'),
    },
    annotations: { title: 'Home health agency search', ...RO },
  }, wrap((a: any) => homeHealthSearch(fetchText, a)));

  server.registerTool('home_health_ratings', {
    title: 'Home health agency ratings and quality measures',
    description:
      'Full Medicare Care Compare profile of one home health agency by ccn (or name and state): quality of patient care star rating with the state and national median, patient survey stars and the four survey topics ' +
      'with state and national percentages, would definitely recommend, 13 quality measures (timely start of care, improvement in walking, bathing, breathing and taking medicines, falls with major injury, pressure ulcers, ' +
      'discharge function, flu shot check) against state and national averages, discharge to community and preventable hospital readmissions and hospitalizations against the national rate, Medicare spending per episode, ' +
      'number of ZIP codes served, services and the Medicare.gov link. A missing value carries the CMS footnote that explains it.',
    inputSchema: ref,
    annotations: { title: 'Home health agency ratings', ...RO },
  }, wrap((a: any) => homeHealthRatings(fetchText, a)));

  server.registerTool('hospice_search', {
    title: 'Find and rank hospices',
    description:
      'Find Medicare-certified hospices that serve a ZIP code (as reported to Medicare), or that have an office in a state, city or county, or by name, ranked by the family caregiver survey (CAHPS Hospice) star rating, ' +
      'the Hospice Care Index or name. Each result has the family survey stars (or the reason there are none), the share of caregivers rating it 9 or 10 and who would definitely recommend it, the Hospice Care Index (0 to 10), ' +
      'ownership, phone and the ccn for hospice_ratings.',
    inputSchema: {
      zip: z.string().optional().describe('5-digit ZIP code where care is needed: lists every hospice that serves it. Best for "near me" questions.'),
      state: z.string().optional().describe('State name or two-letter code (all hospices in the state, or narrows a ZIP, city or county search).'),
      city: z.string().optional().describe('City of the hospice office.'),
      county: z.string().optional().describe('County of the hospice office (needs state).'),
      name: z.string().optional().describe('Hospice name or part of it.'),
      min_stars: z.number().int().min(1).max(5).optional().describe('Minimum family caregiver survey star rating.'),
      sort: z.enum(['family_rating', 'care_index', 'name']).optional().describe('family_rating (default: stars, then would recommend), care_index or name.'),
      limit: z.number().int().min(1).max(50).optional().describe('How many hospices to return. Default 15.'),
    },
    annotations: { title: 'Hospice search', ...RO },
  }, wrap((a: any) => hospiceSearch(fetchText, a)));

  server.registerTool('hospice_ratings', {
    title: 'Hospice ratings and quality measures',
    description:
      'Full Medicare Care Compare profile of one hospice by ccn (or name and state): family caregiver survey star rating and the seven survey results (communication, timely help, respect, emotional support, ' +
      'help with pain and symptoms, rating 9 or 10, would recommend) against state and national averages, comprehensive assessment at admission, nurse or social worker visits in the last days of life, ' +
      'the Hospice Care Index score and its 10 indicators with national percentiles (live discharges, nursing visit gaps, nurse minutes, spending per beneficiary), average daily census, ' +
      'diagnosis mix, where care is given (home, assisted living, nursing facility) and ZIP codes served. A missing value carries the CMS footnote that explains it.',
    inputSchema: ref,
    annotations: { title: 'Hospice ratings', ...RO },
  }, wrap((a: any) => hospiceRatings(fetchText, a)));

  return server;
}
