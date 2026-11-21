// screenshots_v5.js - DEVELOPMENT ONLY. The three pages at the two laptop sizes
// (1366x768 and 1440x900) into docs/screens/v5/. Needs the dev server (mock engine):
//   python gui/dev/dev_server.py --port 8765
//   node gui/dev/screenshots_v5.js
// Prints a warning if a page overflows its window (something cut off at the bottom).
// Panels that scroll on purpose (editor, log, trace, the Analysis report) are skipped.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "docs", "screens", "v5");
const SHIM = path.join(__dirname, "shim.js");
const SIZES = [[1366, 768], [1440, 900]];

// A page "fits" when no scroll container inside it is taller than its box.
async function checkFits(page, label) {
  const over = await page.evaluate(() => {
    const cur = document.querySelector(".page:not([hidden])");
    const bad = [];
    for (const el of [cur, ...cur.querySelectorAll("*")]) {
      const st = getComputedStyle(el);
      if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0 &&
          !el.closest(".CodeMirror, .log-list, .trace-plot, .an-wrap, .profile") &&
          !el.classList.contains("page-analysis")) {           // the report scrolls on purpose (Table 2)
        bad.push(`${el.className || el.id} ${el.scrollHeight}>${el.clientHeight}`);
      }
    }
    return bad;
  });
  if (over.length) console.warn(`  ${label}: overflows -> ${over.join(", ")}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.addInitScript({ path: SHIM });
    await page.goto("http://127.0.0.1:8765/index.html");
    await page.waitForFunction(() => window.miniCpu && window.miniCpu.state.engine.state !== "checking");
    const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}_${w}x${h}.png`) });

    // Cover: after the plotter intro, the idle demo on step 6
    await page.waitForTimeout(1500 + 6 * 600 + 150);
    await checkFits(page, `cover ${w}x${h}`);
    await shot("01_cover");

    // Workbench: demo 03 (loop sum) run to the end, cursor on step 6
    await page.evaluate(() => window.miniCpu.update({ speed: "instant" }));
    await page.keyboard.press("3");
    await page.waitForFunction(() => window.miniCpu.state.result && !window.miniCpu.state.playing, null, { timeout: 20000 });
    await page.evaluate(() => { window.miniCpu.update({ speed: "1" }); window.miniCpu.goTo(6); });
    await page.mouse.move(w - 5, h - 5);
    await page.waitForTimeout(3500);                                // the "Halted" toast fades
    await checkFits(page, `workbench ${w}x${h}`);
    await shot("02_workbench");

    // Analysis of the same run
    await page.keyboard.press("Alt+3");
    await page.waitForTimeout(900);
    await checkFits(page, `analysis ${w}x${h}`);
    await shot("03_analysis");
    await page.close();
  }
  await browser.close();
  console.log("screenshots written to", OUT);
})();
