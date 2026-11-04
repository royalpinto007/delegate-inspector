import type { Inspection } from "./types.js";
export function markdown(report: Inspection): string {
  const lines = [
    "# delegate? permission report",
    "",
    `Source: ${report.source === "example" ? "Fictional offline example (not live chain data)" : "Public Solana RPC"}`,
    `Address: ${report.wallet}`,
    `Network: ${report.network}`,
    `Observed: ${report.observedAt}`,
    `Coverage: ${report.status === "complete" ? "Scoped reads complete" : "Partial inspection"}`,
    "",
    "This is not a wallet safety verdict.",
    "",
    "## Summary",
    "",
    `- Token accounts decoded: ${report.summary.accounts}`,
    `- Accounts with ordinary delegates: ${report.summary.delegatedAccounts}`,
    `- Nonzero ordinary allowances: ${report.summary.nonzeroAllowances}`,
    `- Accounts with a mint permanent delegate: ${report.summary.permanentDelegateAccounts}`,
    `- External close authorities: ${report.summary.externalCloseAuthorities}`,
    `- Frozen accounts: ${report.summary.frozenAccounts}`,
    "",
    "## Program reads",
    "",
  ];
  for (const p of report.programs)
    lines.push(
      `- ${p.program}: ${p.status}; slot ${p.slot ?? "unavailable"}; returned ${p.returned}`,
    );
  for (const account of report.accounts) {
    lines.push(
      "",
      `## Account ${account.address}`,
      "",
      `- Program: ${account.program}`,
      `- Mint: ${account.mint}`,
      `- Token-account owner: ${account.owner}`,
      `- State: ${account.state}`,
      `- Balance: ${account.amount ?? "Unverified decimals"}; raw: ${account.amountRaw}`,
      `- Ordinary delegate: ${account.delegate ?? "None recorded"}`,
      `- Remaining allowance: ${account.allowance ?? "Unverified decimals"}; raw: ${account.allowanceRaw}`,
      `- Effective close authority: ${account.effectiveCloseAuthority}${account.closeAuthority ? " (explicit)" : " (defaults to owner)"}`,
      `- Mint read: ${account.mintRead}`,
      `- Permanent delegate: ${account.mintRead === "unavailable" ? "Unverified" : (account.mintInfo?.permanentDelegate ?? "None recorded")}`,
      `- Mint freeze authority: ${account.mintRead === "unavailable" ? "Unverified" : (account.mintInfo?.freezeAuthority ?? "None recorded")}`,
      `- Account slot: ${account.slot}; mint slot: ${account.mintSlot ?? "unavailable"}`,
    );
    for (const ext of [
      ...account.extensions,
      ...(account.mintInfo?.extensions ?? []),
    ])
      lines.push(
        `- Extension ${ext.name} (#${ext.type}, ${ext.bytes} bytes): ${ext.interpreted ? "interpreted within scope" : "not interpreted"}`,
      );
    for (const note of account.notes) lines.push(`- ${note}`);
  }
  if (report.issues.length) {
    lines.push("", "## Incomplete observations", "");
    for (const issue of report.issues)
      lines.push(
        `- ${issue.code}${issue.address ? " (" + issue.address + ")" : ""}: ${issue.message}`,
      );
  }
  lines.push(
    "",
    "## Scope",
    "",
    ...report.scope.map((s) => "- " + s),
    "",
    `Limits: ${report.limits.accountsPerProgram} accounts per program, ${report.limits.mints} distinct mints. Amounts use base decimals only.`,
    "",
  );
  return lines.join("\n");
}
