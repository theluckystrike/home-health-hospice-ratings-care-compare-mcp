# Data sources

All data is read at call time from the CMS Provider Data Catalog on data.cms.gov, the data behind Medicare Care Compare. No key is needed. Reads use the DKAN datastore query API `https://data.cms.gov/provider-data/api/1/datastore/query/<dataset>/0` with `=`, `like` and `in` conditions (at most 1500 rows per read, paged with `offset`), and the metastore for each dataset's modified date (`as_of`). Successful answers are cached at the Cloudflare edge for 6 hours; errors are not cached.

| Dataset | Id | Used for |
| --- | --- | --- |
| Home Health Care Agencies | `6jpm-sxkc` | name, address, ownership, services, quality of patient care star rating, OASIS quality measures, discharge to community, preventable readmissions and hospitalizations, Medicare spending per episode |
| Home Health Care - Patient Survey (HHCAHPS) | `ccn4-8vby` | summary and topic star ratings, rated 9 or 10, would recommend, completed surveys |
| Home Health Care - Patient Survey (HHCAHPS) State / National Data | `m5jg-jg7i` / `vxub-6swi` | state and national survey percentages |
| Home Health Care - State by State / National Data | `tee5-ixt5` / `97z8-de96` | state and national averages and median star ratings |
| Home Health Care - Zip Codes | `m5eg-upu5` | ZIP codes each agency serves |
| Hospice - General Information | `yc9t-dgbk` | name, address, county, ownership, certification date |
| Hospice - Provider Data | `252m-zfp9` | HIS measures, visits in the last days of life, Hospice Care Index and indicators, census, diagnoses, care settings |
| Hospice care - Provider CAHPS Hospice Survey Data | `gxki-hrr8` | family caregiver star rating and survey results |
| Hospice care - State / National CAHPS Hospice Survey Data | `a55e-5b88` / `7cv8-v37d` | state and national survey results |
| Hospice - State Data / National Data | `eda0-92f0` / `3xeb-u9wp` | state and national measure averages |
| Hospice - Zip Data | `95rg-2usp` | ZIP codes each hospice serves |

Footnote texts come from the CMS data dictionaries (HHQRP and HHVBP Data Dictionary, April 2026, Table 14; Hospice Data Dictionary, Table 16) and are copied into the code. CMS data on data.cms.gov is a U.S. government work.
