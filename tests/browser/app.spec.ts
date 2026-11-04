import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const wallet = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
test("real offline inspection, filters, details and exports", async ({
  page,
}) => {
  const errors: string[] = [];
  const outbound: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (!req.url().startsWith("http://127.0.0.1:4481"))
      outbound.push(req.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Try permission review" }).click();
  await expect(page.getByTestId("source-label")).toHaveText("Offline example");
  await expect(page.getByTestId("account-count")).toHaveText("3");
  await expect(page.getByTestId("permanent-count")).toHaveText("1");
  await expect(
    page.getByText("Fictional data. No RPC requests were made."),
  ).toBeVisible();
  await expect(
    page.getByText("Ordinary delegate", { exact: true }).first(),
  ).toBeVisible();
  await page.getByLabel("Permission filter").selectOption("permanent");
  await expect(page.locator(".account-row")).toHaveCount(1);

  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const file = await jsonDownload;
  const path = await file.path();
  expect(path).toBeTruthy();
  const report = JSON.parse(await readFile(path!, "utf8"));
  expect(report.source).toBe("example");
  expect(report.accounts).toHaveLength(3);
  const mdDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Markdown" }).click();
  const md = await mdDownload;
  expect(await readFile((await md.path())!, "utf8")).toContain(
    "Fictional offline example",
  );
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Read the permissions" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Inspection", exact: true }).click();
  await expect(page.getByTestId("account-count")).toHaveText("3");
  await expect(page.getByLabel("Public wallet address")).toHaveValue(wallet);
  expect(errors).toEqual([]);
  expect(outbound).toEqual([]);
});
test("empty and partial results do not imply wallet safety", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Offline example").selectOption("partial");
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await expect(page.getByTestId("coverage-label")).toHaveText(
    "Partial inspection",
  );
  await expect(
    page.getByText("Unverified", { exact: true }).first(),
  ).toBeVisible();
  await page.getByLabel("Offline example").selectOption("empty");
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await expect(
    page.getByText("No token accounts returned", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This is not a wallet safety verdict.", { exact: true }),
  ).toBeVisible();
});
test("loading, structured live error, retry and invalid input", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Public wallet address").fill("not-an-address");
  await page
    .getByRole("button", { name: "Inspect address", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("public Solana address");
  await page.getByLabel("Public wallet address").fill(wallet);
  let attempt = 0;
  await page.route("**/api/inspections", async (route) => {
    attempt++;
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (attempt === 1)
      await route.fulfill({
        status: 429,
        json: {
          error: {
            code: "RPC_RATE_LIMIT",
            message: "Public RPC rate limit reached. Retry later.",
          },
        },
      });
    else {
      const response = await route.fetch({
        url: "http://127.0.0.1:4481/api/examples/plain",
        method: "GET",
        postData: undefined,
        headers: {},
      });
      await route.fulfill({ response });
    }
  });
  await page
    .getByRole("button", { name: "Inspect address", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Inspecting…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("rate limit");
  await page.getByRole("button", { name: "Retry lookup" }).click();
  await expect(page.getByTestId("account-count")).toHaveText("2");
  expect(attempt).toBe(2);
});
test("responsive layouts have no page overflow", async ({ page }) => {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Try permission review" }).click();
    await expect(page.getByTestId("account-count")).toHaveText("3");
    if (width < 820) {
      const bounds = await page
        .getByRole("region", { name: "Inspection report" })
        .boundingBox();
      expect(bounds?.y).toBeLessThan(100);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Architecture", exact: true })
      .click();
    await expect(
      page.getByAltText(
        "delegate? architecture: local dashboard and CLI, read-only scanner, public RPC and report exports",
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test("invalid new input hides the previous report and cannot retry a stale example", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try permission review" }).click();
  await expect(page.getByTestId("account-count")).toHaveText("3");
  await page.getByLabel("Public wallet address").fill("invalid");
  await page.locator("#inspect-button").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Inspection report" }),
  ).toBeHidden();
  await expect(page.getByRole("button", { name: "Retry lookup" })).toBeHidden();
});
test("an RPC error containing markup is rendered as text", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Public wallet address").fill(wallet);
  await page.route("**/api/inspections", (route) =>
    route.fulfill({
      status: 502,
      json: {
        error: {
          message:
            '<img src=x onerror="window.injected=true"> upstream failure',
        },
      },
    }),
  );
  await page
    .getByRole("button", { name: "Inspect address", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("<img src=x");
  expect(await page.locator("#error img").count()).toBe(0);
});
