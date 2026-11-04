import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("initial page, report and in-app help pass automated WCAG checks", async ({
  page,
}) => {
  await page.goto("/");
  for (const state of ["initial", "report", "help"] as const) {
    if (state === "report") {
      await page.getByRole("button", { name: "Try permission review" }).click();
      await expect(page.getByTestId("account-count")).toHaveText("3");
    }
    if (state === "help")
      await page.getByRole("button", { name: "Help", exact: true }).click();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      result.violations,
      `${state}: ${JSON.stringify(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))}`,
    ).toEqual([]);
  }
});
