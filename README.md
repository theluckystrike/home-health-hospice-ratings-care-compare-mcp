# home-health-hospice-ratings-care-compare-mcp

Home health and hospice ratings for AI assistants: the Medicare Care Compare quality star ratings, patient and family caregiver survey results and quality measures for every Medicare-certified home health agency (12,409) and hospice (6,669) in the US. Ask which home health agencies serve your parent's ZIP code and how they rate, how a hospice scores with families, or how an agency compares with the state average before you choose.

This is a Model Context Protocol (MCP) server. It reads the home health and hospice datasets that CMS publishes in the Provider Data Catalog on data.cms.gov at call time. It needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `home_health_search` | Home health agencies that serve a ZIP code (as reported to Medicare), or with an office in a state or city, or by name, ranked by the quality of patient care star rating (half stars), patient survey stars or name, with services offered, the share of patients rating the agency 9 or 10 and who would definitely recommend it, and the star distribution. |
| `home_health_ratings` | One home health agency in full: quality star rating against the state and national median, patient survey stars and topics, 13 quality measures (timely start of care, improvement in walking, bathing and breathing, falls with major injury, pressure ulcers) against state and national averages, discharge to community and preventable hospital use against the national rate, Medicare spending per episode and ZIP codes served. |
| `hospice_search` | Hospices that serve a ZIP code (as reported to Medicare), or with an office in a state, city or county, or by name, ranked by family caregiver survey stars (then would recommend), the Hospice Care Index or name, with the star distribution. |
| `hospice_ratings` | One hospice in full: family caregiver survey stars and the seven survey results against state and national averages, comprehensive assessment at admission, nurse or social worker visits in the last days of life, the Hospice Care Index and its 10 indicators with national percentiles, average daily census, diagnosis mix, care settings and ZIP codes served. |

Every result has structured JSON, a plain-text summary, `as_of`, `source` and `more` (a page on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=home-health-hospice-ratings-care-compare-mcp)). Every tool is marked read-only.

## What it knows that your model does not

- The current Medicare Care Compare star ratings of every certified home health agency and hospice (home health quality and patient survey stars refreshed September 2026, hospice family caregiver stars August 2026), with the CMS footnote that explains a missing rating.
- Which agencies actually serve a given ZIP code, from the ZIP code lists that agencies report to Medicare, not just the agencies with an office nearby.
- Each agency's quality measures, hospital use, Medicare spending and (for hospices) the Hospice Care Index and visits in the last days of life, next to the state and national averages.

## Install

### Hosted (custom connector, ChatGPT developer mode, any remote MCP client)

Paste this URL. No token, no sign-up.

```
https://home-health-hospice-ratings-care-compare-mcp.lipmichal.workers.dev/mcp
```

### Cursor

Add to `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "home-health-hospice": { "url": "https://home-health-hospice-ratings-care-compare-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`.

```json
{
  "servers": {
    "home-health-hospice": { "type": "http", "url": "https://home-health-hospice-ratings-care-compare-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### Local stdio

The npm package is not published. Build it from this repository with Node 20 or newer, then point your MCP client at `node /path/to/home-health-hospice-ratings-care-compare-mcp/dist/stdio.js`.

```
git clone https://github.com/theluckystrike/home-health-hospice-ratings-care-compare-mcp && cd home-health-hospice-ratings-care-compare-mcp
npm install && npm run build
node dist/stdio.js
```

## Example prompts

- "Which home health agencies serve ZIP 05401, and which have the best ratings?"
- "We need hospice care for my father in Burlington, Vermont (ZIP 05401). Which hospices serve that area and what do families say about them?"
- "How does UVMHN Home Health and Hospice compare with the Vermont average on starting care on time and patient outcomes?"
- "Show me the Care Compare ratings for Bayada Hospice in Vermont."

## Data sources

Full list in [DATA_SOURCES.md](DATA_SOURCES.md).

- CMS Provider Data Catalog (Medicare Care Compare), home health datasets: https://data.cms.gov/provider-data/topics/home-health-services
- CMS Provider Data Catalog (Medicare Care Compare), hospice datasets: https://data.cms.gov/provider-data/topics/hospice-care

## Limitations

- Medicare-certified agencies only. Private-pay home care (non-medical caregivers) is not in this data.
- Ratings and measures cover past periods (home health quality measures from 2025, hospice family survey October 2023 to September 2025); CMS refreshes them quarterly.
- ZIP search lists the agencies that report serving a ZIP code to Medicare; it is not a distance search and an agency may not have capacity.
- Smaller agencies often have too few surveys or episodes for a star rating; the answer gives the CMS reason instead of a number.
- The Medicare.gov links use the Care Compare details URL pattern and were not opened from this server.

## More

More MCP servers that answer questions your assistant cannot answer alone are on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=home-health-hospice-ratings-care-compare-mcp).

Part of the Zovo MCP collection at https://mcp.zovo.one

Built by [theluckystrike](https://github.com/theluckystrike).

## Development

```
npm install
npm test                              # builds, then runs the fixture tests and an offline stdio test
node scripts/stdio-transcript.mjs     # live stdio round trip, writes .live/stdio-transcript.jsonl
```

CI (`.github/workflows/bundle.yml`) runs the tests, the type check and `wrangler deploy --dry-run --outdir out`, and uploads the Worker bundle as an artifact.

## License

MIT
