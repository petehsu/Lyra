const { chromium } = require("playwright");

const BASE_URL = "https://styles.refero.design";

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const withBrowser = async (payload, callback) => {
  const browser = await chromium.launch({ headless: payload.headless !== false });
  try {
    const page = await browser.newPage();
    return await callback(page);
  } finally {
    await browser.close();
  }
};

const searchReferences = async (payload) => {
  const query = cleanText(payload.query);
  if (query.length === 0) {
    throw new Error("query is required for search_references");
  }
  const limit = Math.max(1, Math.min(Number(payload.limit ?? 10) || 10, 25));
  return await withBrowser(payload, async (page) => {
    await page.goto(`${BASE_URL}/?${new URLSearchParams({ q: query })}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForSelector('a[href^="/style/"]', { timeout: 10000 });
    return await page.$$eval('a[href^="/style/"]', (anchors, maxResults) => {
      const seen = new Set();
      const results = [];
      for (const anchor of anchors) {
        const href = anchor.getAttribute("href") ?? "";
        const id = href.replace(/\/$/, "").split("/").pop() ?? "";
        if (id.length === 0 || seen.has(id)) {
          continue;
        }
        seen.add(id);
        const title =
          anchor.querySelector("h3")?.textContent?.trim()
          || anchor.querySelector("img[alt]")?.getAttribute("alt")?.trim()
          || "Unknown";
        results.push({ title, id });
        if (results.length >= maxResults) {
          break;
        }
      }
      return results;
    }, limit);
  });
};

const getCodeFromTab = async (page, tabName) => {
  const tab = page.getByRole("tab", { name: tabName });
  if ((await tab.count()) === 0) {
    return "";
  }
  await tab.first().click({ force: true });
  await page.waitForTimeout(300);
  const code = page.locator("pre").first();
  return (await code.count()) > 0 ? await code.innerText() : "";
};

const getReferenceDetails = async (payload) => {
  const referenceId = cleanText(payload.reference_id);
  if (referenceId.length === 0) {
    throw new Error("reference_id is required for get_reference_details");
  }
  return await withBrowser(payload, async (page) => {
    await page.goto(`${BASE_URL}/style/${referenceId}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForSelector("h1", { timeout: 10000 });
    const title = cleanText(await page.locator("h1").first().innerText());
    const screenshotUrl = await page
      .locator('img[alt^="Screenshot"]')
      .first()
      .getAttribute("src")
      .catch(() => "");
    const techData = {};
    for (const tabName of ["DESIGN.md", "Tailwind v4", "CSS Variables", "Design Tokens"]) {
      const content = await getCodeFromTab(page, tabName);
      if (content.trim().length > 0) {
        techData[tabName] = content;
      }
    }
    return {
      id: referenceId,
      title,
      screenshot_url: screenshotUrl ?? "",
      tech_data: techData,
    };
  });
};

const main = async () => {
  const action = process.argv[2];
  const payload = JSON.parse(process.argv[3] ?? "{}");
  if (action === "search_references") {
    return await searchReferences(payload);
  }
  if (action === "get_reference_details") {
    return await getReferenceDetails(payload);
  }
  throw new Error(`Unsupported action: ${action}`);
};

main()
  .then((result) => {
    console.log(JSON.stringify({ ok: true, action: process.argv[2], result }));
  })
  .catch((error) => {
    console.log(JSON.stringify({
      ok: false,
      action: process.argv[2],
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  });
