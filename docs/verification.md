# Verification

Checked locally on **4 November 2026**, using Node.js **22.22.2** on Linux.

| Check                                             | Result                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Prettier, ESLint, TypeScript and production build | Passed                                                                                                      |
| Unit and HTTP integration tests                   | 44 passed                                                                                                   |
| Chromium desktop and mobile browser tests         | 14 passed                                                                                                   |
| Automated accessibility                           | No WCAG 2/2.1 A/AA violations detected in the initial screen, report and Help views at desktop/mobile sizes |
| Responsive checks                                 | 360, 768 and 1280 px; no horizontal page overflow; mobile results brought into view                         |
| Packaged layout and CLI                           | Offline JSON inspection passed from an extracted npm tarball                                                |
| Dependency audit                                  | Zero known vulnerabilities, including development dependencies                                              |
| Live Mainnet and Devnet                           | Both token programs read successfully; wrapped-SOL mint decoded on each network                             |

The live smoke checks used fresh public addresses that returned no token accounts. Mainnet token-program slots were 465298324/465298325; Devnet slots were 518573089/518573089. The wrapped-SOL mint returned base decimals 9. These were read-only requests. Delegated, frozen and permanent-delegate states are verified using synthetic binary fixtures through the same decoder and scanner, rather than claiming those states were observed live.

## Review coverage

- Exact maximum-u64 allowances, zero allowances, absent close authority and frozen state.
- Mint-level permanent delegates even when ordinary delegation is absent.
- Wrapped-SOL close-authority semantics, unsupported extensions, malformed TLV and mismatched program/account authority.
- Stale contexts, missing mints, one failed token program, both failed programs, limits, duplicates, RPC rate limits and streaming timeouts.
- Host rebinding, foreign/null Origin, cross-site requests, JSON size/type boundaries, local rate/concurrency limits and error redaction.
- UI loading/error/retry, stale-result clearing, text-only markup rendering, in-app Help, filters and full-report JSON/Markdown exports.
- Visual review of the actual desktop and mobile screenshots; no collisions found.

Review found and fixed a missing wrapped-SOL closure note, stale results after invalid input, the submit button’s changing accessible name, ambiguous account-count labels and mobile result positioning. Regression tests cover the behavioral fixes.

## Limits of this verification

Automated accessibility checks do not replace screen-reader/manual accessibility testing. Browser checks cover Chromium; Firefox, Safari and physical mobile devices were not tested. RPC reads are separate observations, subject to provider availability, not an atomic snapshot or safety proof. Unknown Token-2022 extensions remain explicitly unverified.

Nothing was published to npm, deployed or posted publicly as part of this build.
