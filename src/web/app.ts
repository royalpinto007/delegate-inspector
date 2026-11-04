import { isAddress } from "../domain/address.js";
import { markdown } from "../domain/report.js";
import type { AccountRow, Inspection, Network } from "../domain/types.js";
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing interface element ${id}`);
  return found as T;
};
const wallet = byId<HTMLTextAreaElement>("wallet"),
  network = byId<HTMLSelectElement>("network"),
  filter = byId<HTMLSelectElement>("permission-filter"),
  search = byId<HTMLInputElement>("search");
const form = byId<HTMLFormElement>("lookup-form"),
  reportElement = byId("report"),
  exampleSelect = byId<HTMLSelectElement>("example-select");
let current: Inspection | null = null;
let page = 0;
const pageSize = 25;
let requestId = 0;
let pending: AbortController | null = null;
let retry: (() => Promise<void>) | null = null;
function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function status(message: string) {
  byId("status").textContent = message;
}
function label(text: string, variant = "neutral") {
  return node("span", "badge " + variant, text);
}
const shorten = (text: string) => text.slice(0, 7) + "…" + text.slice(-7);
async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    status(message);
  } catch {
    status("Clipboard unavailable. Use JSON or Markdown export instead.");
  }
}
function addressLine(value: string, name: string) {
  const line = node("div", "address-line");
  const code = node("code", "", value);
  const button = node("button", "copy-address", "⧉");
  button.type = "button";
  button.setAttribute("aria-label", `Copy ${name}`);
  button.title = `Copy ${name}`;
  button.addEventListener("click", () => {
    void copy(value, "Address copied.");
  });
  line.append(code, button);
  return line;
}
function authority(title: string, value: string, raw?: string, variant = "") {
  const block = node("div", "authority");
  block.append(
    node("p", "authority-label", title),
    node("p", "authority-value " + variant, value),
  );
  if (raw !== undefined) block.append(node("small", "", raw));
  return block;
}
function accountRow(account: AccountRow, index: number, open: boolean) {
  const details = node("details", "account-row");
  details.open = open;
  const summary = node("summary");
  const heading = node("div", "account-heading");
  heading.append(
    node(
      "strong",
      "",
      account.program === "spl-token"
        ? "SPL Token account"
        : "Token-2022 account",
    ),
  );
  const code = node("code", "", shorten(account.address));
  code.title = account.address;
  heading.append(code);
  const badges = node("div", "row-badges");
  if (account.delegate)
    badges.append(
      label(
        account.allowanceRaw === "0"
          ? "Delegate · zero allowance"
          : "Ordinary delegate",
        account.allowanceRaw === "0" ? "neutral" : "",
      ),
    );
  if (account.mintInfo?.permanentDelegate)
    badges.append(label("Permanent delegate", "warning"));
  if (account.state === "frozen") badges.append(label("Frozen", "warning"));
  if (account.effectiveCloseAuthority !== account.owner)
    badges.append(label("External close authority", "warning"));
  if (
    account.mintRead === "unavailable" ||
    account.extensions.some((e) => !e.interpreted) ||
    account.mintInfo?.extensions.some((e) => !e.interpreted)
  )
    badges.append(label("Unverified", "warning"));
  if (!badges.childElementCount)
    badges.append(label("No delegate recorded", "neutral"));
  summary.append(
    node("span", "account-index", String(index + 1).padStart(2, "0")),
    heading,
    badges,
  );
  details.append(summary);
  const body = node("div", "account-body"),
    grid = node("div", "authority-grid");
  grid.append(
    authority("Ordinary delegate", account.delegate ?? "None recorded"),
    authority(
      "Remaining allowance",
      account.allowance === null
        ? `${account.allowanceRaw} raw units`
        : account.allowance,
      `Raw: ${account.allowanceRaw}`,
    ),
    authority(
      "Mint permanent delegate",
      account.mintRead === "unavailable"
        ? "Unverified"
        : (account.mintInfo?.permanentDelegate ?? "None recorded"),
      undefined,
      account.mintRead === "unavailable"
        ? "unverified"
        : account.mintInfo?.permanentDelegate
          ? "permanent-value"
          : "",
    ),
    authority(
      "Effective close authority",
      account.effectiveCloseAuthority === account.owner
        ? "Account owner"
        : account.effectiveCloseAuthority,
      account.closeAuthority
        ? "Explicit close authority"
        : "Defaults to account owner",
    ),
  );
  body.append(grid);
  if (account.notes.length) {
    const notes = node("ul", "account-notes");
    for (const note of account.notes) notes.append(node("li", "", note));
    body.append(notes);
  }
  const more = node("details", "account-more");
  more.append(node("summary", "", "Balances, addresses & extensions"));
  const data = node("dl", "details-data");
  for (const [title, value] of [
    ["Token account", account.address],
    ["Mint", account.mint],
    ["Token-account owner", account.owner],
    ["Effective close authority", account.effectiveCloseAuthority],
  ] as const) {
    const dd = node("dd");
    dd.append(addressLine(value, title.toLowerCase()));
    data.append(node("dt", "", title), dd);
  }
  for (const [title, value] of [
    ["Balance (base decimals only)", account.amount ?? "Unverified decimals"],
    ["Balance raw units", account.amountRaw],
    ["Allowance raw units", account.allowanceRaw],
    [
      "Mint freeze authority",
      account.mintRead === "unavailable"
        ? "Unverified"
        : (account.mintInfo?.freezeAuthority ?? "None recorded"),
    ],
    ["State", account.state],
    ["Wrapped native token", account.native ? "Yes" : "No"],
    [
      "Observation slots",
      `Account ${account.slot} / mint ${account.mintSlot ?? "unavailable"}`,
    ],
  ] as const)
    data.append(node("dt", "", title), node("dd", "", value));
  more.append(data);
  const extensions = [
    ...account.extensions.map((e) => ({ ...e, location: "Account" })),
    ...(account.mintInfo?.extensions ?? []).map((e) => ({
      ...e,
      location: "Mint",
    })),
  ];
  if (extensions.length) {
    more.append(node("h3", "", "Extensions"));
    const list = node("ul", "extensions-list");
    for (const extension of extensions)
      list.append(
        node(
          "li",
          "",
          `${extension.location}: ${extension.name} (#${extension.type}, ${extension.bytes} bytes) · ${extension.interpreted ? "interpreted within scope" : "not interpreted"}`,
        ),
      );
    more.append(list);
  }
  body.append(more);
  details.append(body);
  return details;
}
function filteredAccounts(): AccountRow[] {
  if (!current) return [];
  const query = search.value.trim().toLowerCase();
  return current.accounts.filter((account) => {
    const match =
      !query ||
      [
        account.address,
        account.mint,
        account.owner,
        account.delegate ?? "",
        account.effectiveCloseAuthority,
        account.mintInfo?.permanentDelegate ?? "",
        account.program,
      ].some((value) => value.toLowerCase().includes(query));
    if (!match) return false;
    switch (filter.value) {
      case "delegated":
        return account.delegate !== null;
      case "permanent":
        return !!account.mintInfo?.permanentDelegate;
      case "frozen":
        return account.state === "frozen";
      case "external-close":
        return account.effectiveCloseAuthority !== account.owner;
      case "unverified":
        return (
          account.mintRead === "unavailable" ||
          account.extensions.some((e) => !e.interpreted) ||
          !!account.mintInfo?.extensions.some((e) => !e.interpreted)
        );
      default:
        return true;
    }
  });
}
function renderRows() {
  if (!current) return;
  const rows = filteredAccounts();
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  page = Math.min(page, pages - 1);
  const holder = byId("accounts");
  holder.replaceChildren();
  rows
    .slice(page * pageSize, (page + 1) * pageSize)
    .forEach((account, i) =>
      holder.append(accountRow(account, page * pageSize + i, i === 0)),
    );
  byId("results-count").textContent =
    `${rows.length} shown of ${current.accounts.length}`;
  byId("no-results").hidden = rows.length > 0;
  byId("no-results-title").textContent = current.accounts.length
    ? "No accounts match this filter"
    : current.status === "partial"
      ? "No accounts decoded from available reads"
      : "No token accounts returned";
  byId("no-results-text").textContent = current.accounts.length
    ? "Try another filter or clear your search."
    : current.status === "partial"
      ? "Some reads are incomplete. Do not interpret this as an absence of permissions."
      : "Both token programs were read for this address. Other program permissions and historical activity are outside this snapshot.";
  byId("pagination").hidden = pages <= 1;
  byId("page-count").textContent = `Page ${page + 1} of ${pages}`;
  byId<HTMLButtonElement>("previous").disabled = page === 0;
  byId<HTMLButtonElement>("next").disabled = page >= pages - 1;
}
function render(report: Inspection) {
  current = report;
  page = 0;
  search.value = "";
  filter.value = "all";
  byId("source-label").textContent =
    report.source === "example" ? "Offline example" : "Live RPC snapshot";
  byId("source-label").className =
    "badge " + (report.source === "example" ? "example" : "");
  byId("coverage-label").textContent =
    report.status === "partial"
      ? "Partial inspection"
      : "Scoped reads complete";
  byId("coverage-label").className =
    "badge " + (report.status === "partial" ? "warning" : "neutral");
  byId("report-context").textContent =
    `${report.network === "mainnet" ? "Mainnet" : "Devnet"} · ${new Date(report.observedAt).toLocaleString()} · ${shorten(report.wallet)}`;
  byId("report-context").title = report.wallet;
  byId("source-note").textContent =
    report.source === "example"
      ? "Fictional data. No RPC requests were made."
      : "Confirmed reads. Separate observations, not an atomic snapshot.";
  for (const [id, count] of [
    ["account-count", report.summary.accounts],
    ["delegate-count", report.summary.delegatedAccounts],
    ["permanent-count", report.summary.permanentDelegateAccounts],
    ["frozen-count", report.summary.frozenAccounts],
  ] as const)
    byId(id).textContent = String(count);
  byId("partial-note").hidden = report.status !== "partial";
  const issueList = byId("issue-list");
  issueList.replaceChildren();
  for (const issue of report.issues)
    issueList.append(
      node(
        "li",
        "",
        `${issue.code}${issue.program ? " · " + issue.program : ""}: ${issue.message}${issue.address ? " (" + issue.address + ")" : ""}`,
      ),
    );
  byId("issues").hidden = !report.issues.length;
  const scope = byId("read-scope");
  scope.replaceChildren();
  const list = node("ul");
  for (const item of report.scope) list.append(node("li", "", item));
  for (const program of report.programs)
    list.append(
      node(
        "li",
        "",
        `${program.program}: ${program.status}; slot ${program.slot ?? "unavailable"}; ${program.returned} accounts returned.`,
      ),
    );
  list.append(
    node(
      "li",
      "",
      `Inspection limits: ${report.limits.accountsPerProgram} accounts per token program, ${report.limits.mints} distinct mints. Exports include all decoded accounts, regardless of the current filter.`,
    ),
  );
  scope.append(list);
  reportElement.hidden = false;
  byId("empty-start").hidden = true;
  renderRows();
  status(
    `Inspection ready. ${report.summary.accounts} token accounts decoded.`,
  );
}
function setLoading(loading: boolean) {
  byId("loading").hidden = !loading;
  byId("lookup-form").setAttribute("aria-busy", String(loading));
  for (const id of [
    "inspect-button",
    "load-example",
    "try-example",
    "network",
    "wallet",
  ])
    (
      byId(id) as HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement
    ).disabled = loading;
  const inspectButton = byId("inspect-button");
  inspectButton.textContent = loading ? "Inspecting…" : "Inspect address";
  if (!loading) {
    const arrow = node("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    inspectButton.append(arrow);
  }
}
async function load(url: string, body?: { wallet: string; network: Network }) {
  const id = ++requestId;
  pending?.abort();
  pending = new AbortController();
  byId("error").hidden = true;
  byId("retry").hidden = false;
  byId("empty-start").hidden = true;
  reportElement.hidden = true;
  current = null;
  setLoading(true);
  status("");
  try {
    const response = await fetch(url, {
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
      signal: pending.signal,
    });
    const data = (await response.json()) as Inspection & {
      error?: { message?: string };
    };
    if (!response.ok)
      throw new Error(
        data.error?.message ??
          "Could not complete this inspection. Retry or use an offline example.",
      );
    if (
      data.schemaVersion !== 1 ||
      !Array.isArray(data.accounts) ||
      !data.summary
    )
      throw new Error(
        "The local server returned an invalid report. Restart the app and retry.",
      );
    if (id !== requestId) return;
    render(data);
    if (data.source === "example") {
      wallet.value = data.wallet;
      network.value = data.network;
    }
  } catch (error) {
    if (id !== requestId) return;
    byId("error").hidden = false;
    byId("error-message").textContent =
      error instanceof Error ? error.message : "The local inspection failed.";
  } finally {
    if (id === requestId) {
      setLoading(false);
      if (window.innerWidth < 820) {
        const target = byId("error").hidden ? reportElement : byId("error");
        if (!target.hidden) target.scrollIntoView({ block: "start" });
      }
    }
  }
}
async function inspect() {
  const address = wallet.value.trim();
  if (!isAddress(address)) {
    reportElement.hidden = true;
    byId("empty-start").hidden = true;
    current = null;
    retry = null;
    status("");
    byId("retry").hidden = true;
    byId("error").hidden = false;
    byId("error-message").textContent =
      "Enter a valid public Solana address. Never enter a private key or seed phrase.";
    wallet.focus();
    return;
  }
  const body = { wallet: address, network: network.value as Network };
  retry = () => load("/api/inspections", body);
  await retry();
}
async function loadExample(id: string) {
  retry = () => load("/api/examples/" + encodeURIComponent(id));
  await retry();
}
function download(kind: "json" | "md") {
  if (!current) return;
  const data =
    kind === "json"
      ? JSON.stringify(current, null, 2) + "\n"
      : markdown(current);
  const url = URL.createObjectURL(
    new Blob([data], {
      type:
        kind === "json" ? "application/json" : "text/markdown;charset=utf-8",
    }),
  );
  const a = node("a");
  a.href = url;
  a.download = `delegate-${current.network}-${current.source === "example" ? "example-" + current.example : current.wallet.slice(0, 8)}.${kind}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status(`${kind === "json" ? "JSON" : "Markdown"} report exported.`);
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void inspect();
});
byId("retry").addEventListener("click", () => {
  if (retry) void retry();
});
byId("load-example").addEventListener("click", () => {
  void loadExample(exampleSelect.value);
});
byId("try-example").addEventListener("click", () => {
  exampleSelect.value = "review";
  void loadExample("review");
});
filter.addEventListener("change", () => {
  page = 0;
  renderRows();
});
search.addEventListener("input", () => {
  page = 0;
  renderRows();
});
byId("previous").addEventListener("click", () => {
  page = Math.max(0, page - 1);
  renderRows();
});
byId("next").addEventListener("click", () => {
  page++;
  renderRows();
});
byId("export-json").addEventListener("click", () => download("json"));
byId("export-markdown").addEventListener("click", () => download("md"));
byId("copy-report").addEventListener("click", () => {
  if (current) void copy(markdown(current), "Markdown report copied.");
});
for (const [id, help] of [
  ["nav-inspect", false],
  ["nav-help", true],
  ["nav-architecture", true],
] as const)
  byId(id).addEventListener("click", () => {
    byId("inspect-view").hidden = help;
    byId("help-view").hidden = !help;
    for (const nav of ["nav-inspect", "nav-help", "nav-architecture"]) {
      byId(nav).classList.toggle("active", nav === id);
      if (nav === id) byId(nav).setAttribute("aria-current", "page");
      else byId(nav).removeAttribute("aria-current");
    }
    if (id === "nav-architecture")
      byId("architecture-section").scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  });
