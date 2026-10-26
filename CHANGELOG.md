# Changelog

## 0.6.0 — 2026-10-26

### Business data access

- Add a unified `topify data` interface for 29 explicitly listed Public API read resources, including projects, prompts and their analytics, competitors, sources, reports/action outputs, recordings and webhook listings. Existing commands remain available.
- Add `data output` for a single AI answer and `data outputs` for paginated answer batches filtered by project, prompt IDs, dates and providers. Responses include full text, model, business metadata and citations. These two commands require the matching Customer API deployment.
- Add JSON/CSV export support and resource-specific filtering, row selection and pagination metadata. `export` can traverse supported collections; a single `data` page is not presented as a complete export.
- Fix the project-list path to `/projects/`, avoiding an authentication-bearing redirect.

### Reliability and access boundaries

- Keep overseas API keys, domestic dashboard sessions, domestic report-tool credentials and overseas browser sessions separate. New read commands do not expose arbitrary API paths.
- Add bounded timeouts and explicit failures for authorization errors, redirects, unavailable sources and upstream errors. Protect exports against accidental overwrite and spreadsheet formula execution.
- Preserve the server's team/project authorization. A team API key does not automatically equal an employee's individual website permissions.
- Include advanced `web-data` queries for 55 explicitly mapped website resources. These require the user's own browser session and are **not** 55 newly supported Public API capabilities.
- Include domestic `domestic` and `tool` clients as separate entry points. They require their corresponding deployed backend capabilities; this release does not deploy the domestic scheduler or its employee-report API changes.

### Release quality

- Run contract tests before the existing GitHub Actions npm publication, update its OIDC-capable runtime, and validate packaged files before publishing.
- Update the vulnerable transitive `fast-uri` dependency within its compatible range. Release audit reports zero known vulnerabilities.
- Ship this changelog with the npm package.

### Not included

- Selena/Reddit remains pending business confirmation. Its skill and experimental source are retained separately; neither a Reddit CLI command nor the skill is shipped in this npm release.
- Complete migration of every website-only resource to API-key authentication and business-user acceptance of every workflow are not claimed complete.
