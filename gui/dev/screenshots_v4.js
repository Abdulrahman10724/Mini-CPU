// screenshots_v4.js - DEVELOPMENT ONLY. Screenshots of the Sign and Carry flags
// into docs/screens/v4/. Needs the dev server (mock engine) on port 8765:
//   python gui/dev/dev_server.py --port 8765
//   node gui/dev/screenshots_v4.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "docs", "screens", "v4");
const SHIM = path.join(__dirname, "shim.js");
const test = (name) => fs.readFileSync(path.join(ROOT, "tests", name + ".txt"), "utf8");

async function open(browser, width = 1440, height = 900) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.addInitScript({ path: SHIM });
  await page.goto("http://127.0.0.1:8765/index.html");
  await page.waitForFunction(() => window.miniCpu && window.miniCpu.state.engine.state !== "checking");
  return page;
}

// New program from the cover (key N), typed in, run by live mode, cursor on step k.
async function program(page, code, k) {
  await page.keyboard.press("n");
  await page.waitForTimeout(400);
  await page.evaluate((c) => document.querySelector(".CodeMirror").CodeMirror.replaceRange(c, { line: 0, ch: 0 }), code);
  await page.waitForFunction(() => window.miniCpu.state.result !== null, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.evaluate((n) => window.miniCpu.goTo(n), k);
  await page.mouse.move(5, 895);
  await page.waitForTimeout(400);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, name), ...opts });

  // 1-2: test 38 (SF and CF from ADD / SUB / CMP), cursor on CMP CX, 9 (SF = 1, CF = 1)
  let page = await open(browser);
  await program(page, test("38_sf_cf_add_sub"), 6);
  await shot(page, "01_workbench_flags.png");
  await shot(page, "02_flags_block.png", { clip: await page.locator("#datapath").boundingBox() });
  await shot(page, "03_log_flag_changes.png", { clip: await page.locator("section.panel.log").boundingBox() });
  await shot(page, "04_trace_flag_rows.png", { clip: await page.locator("section.panel.trace").boundingBox() });
  await page.close();

  // 5: test 39, cursor on INC AX after the borrow: CF stays 1
  page = await open(browser);
  await program(page, test("39_cf_inc_dec_unchanged"), 3);
  await shot(page, "05_inc_keeps_cf.png");
  await page.close();

  // 6: test 40, JS / JNS / JC / JNC, cursor on the taken JC
  page = await open(browser);
  await program(page, test("40_js_jc_jumps").split("\n").slice(0, 15).join("\n") + "\n", 13);
  await shot(page, "06_js_jc_jumps.png");
  await page.keyboard.press("F1");
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const cap = [...document.querySelectorAll("#helpDrawer .tcaption")].find((p) => p.textContent.startsWith("Flags"));
    cap.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(200);
  await shot(page, "07_help_flags.png");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+3");
  await page.waitForTimeout(900);
  await page.locator("#traceTable").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await shot(page, "08_analysis_flag_columns.png");
  await page.close();

  // 9: the smallest supported window
  page = await open(browser, 1280, 800);
  await program(page, test("38_sf_cf_add_sub"), 10);
  await shot(page, "09_workbench_1280.png");
  await page.close();

  await browser.close();
  console.log("screenshots written to", OUT);
})();
