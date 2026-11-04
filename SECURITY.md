# Security

This is a read-only local tool. Run it on your own machine and keep the loopback bind. There is no wallet, private-key input, transaction submission, database or developer-operated service.

RPC data is untrusted. Address, response, account and binary-layout boundaries are validated. Unsupported or malformed observations are explicitly incomplete. Live requests expose the queried public address to the chosen public RPC provider.

Report vulnerabilities privately to royalpinto007@gmail.com. Include reproduction steps and a minimal public/synthetic fixture. Never send private keys, seed phrases or access tokens.

Dependency audits include development tools. The minimatch 11.0.1 override addresses the upstream advisory affecting older matcher versions; the pinned ESLint/TypeScript toolchain is checked with the override. TypeScript 6 is retained because typescript-eslint 8.72.1 supports versions below 6.1.
