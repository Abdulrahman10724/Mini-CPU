// screenshots_v3.js - DEVELOPMENT ONLY. Screenshots of §1 Cover and §3 Analysis
// into docs/screens/v3/. Needs the dev server (mock engine) on port 8765:
//   python gui/dev/dev_server.py --port 8765
//   node gui/dev/screenshots_v3.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "docs", "screens", "v3");
const SHIM = path.join(__dirname, "shim.js");

async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.addInitScript({ path: SHIM });
  await page.goto("http://127.0.0.1:8765/index.html");
  await page.waitForFunction(() => window.miniCpu && window.miniCpu.state.engine.state !== "checking");
  return page;
}

// Run a demo from the cover (key 1/2/3) and wait until it is finished.
async function runDemo(page, key) {
  await page.evaluate(() => window.miniCpu.update({ speed: "instant" }));
  await page.keyboard.press(key);
  await page.waitForFunction(() => window.miniCpu.state.result && !window.miniCpu.state.playing, null, { timeout: 20000 });
  await page.waitForTimeout(300);
}

async function typeProgram(page, code) {
  await page.evaluate((c) => document.querySelector(".CodeMirror").CodeMirror.replaceRange(c, { line: 0, ch: 0 }), code);
  await page.waitForFunction(() => window.miniCpu.state.result !== null, null, { timeout: 20000 });
  await page.waitForTimeout(400);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, name), ...opts });

  // 1-3: the cover
  let page = await open(browser);
  await page.waitForTimeout(1500 + 6 * 600 + 150);           // plotter intro, then demo step 6
  await shot(page, "01_cover.png");
  const pin = await page.locator('[data-pin="ZF"] .pin-hit').boundingBox();
  await page.mouse.move(pin.x + 60, pin.y + 12);
  await page.waitForTimeout(300);
  await shot(page, "02_cover_pin_hover.png");
  await page.mouse.move(300, 300);
  await page.evaluate(() => {                                // a file dragged over the page
    const dt = new DataTransfer();
    dt.items.add(new File(["MOV AX, 1\nHLT\n"], "my_program.txt", { type: "text/plain" }));
    document.getElementById("pageCover").dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
  });
  await page.waitForTimeout(200);
  await shot(page, "03_cover_drag_file.png");
  await page.close();

  // 4-7, 9-10: analysis of demo 03
  page = await open(browser);
  await runDemo(page, "3");
  await page.keyboard.press("Alt+3");
  await page.waitForTimeout(800);
  await shot(page, "04_analysis_loop_sum.png");
  const hit = await page.locator(".chart-hit").boundingBox();
  await page.mouse.move(hit.x + hit.width * 0.5, hit.y + 80);
  await page.waitForTimeout(250);
  await shot(page, "05_analysis_crosshair.png");
  await page.locator("#fig5").scrollIntoViewIfNeeded();
  const arc = await page.locator(".arc-path").boundingBox();
  await page.mouse.move(arc.x + 1, arc.y + arc.height / 2);
  await page.waitForTimeout(250);
  await shot(page, "06_analysis_profile_arcs.png");
  await page.click('#traceFilters [data-reg="CX"]');
  await page.locator("#traceTable").scrollIntoViewIfNeeded();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(200);
  await shot(page, "07_analysis_trace_filter.png");
  await page.click('#traceFilters [data-f="all"]');
  await page.evaluate(() => { window.dispatchEvent(new Event("beforeprint")); });
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(300);
  await shot(page, "09_print_preview.png", { fullPage: true });
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => { window.dispatchEvent(new Event("afterprint")); });
  await page.evaluate(() => document.querySelector('#sectionIndex a[data-sec="workbench"]').click());
  await page.waitForFunction(() => document.getElementById("pageWorkbench").classList.contains("page-in"));
  await page.evaluate(() => {                                // freeze early in the sheet-turn (220 ms)
    for (const a of document.getAnimations()) if (a.animationName === "sheet-in") { a.pause(); a.currentTime = 50; }
  });
  await page.waitForTimeout(100);
  await shot(page, "10_section_switch.png");
  await page.close();

  // 8: a 500-step LOOP program
  page = await open(browser);
  await page.keyboard.press("n");
  await page.waitForTimeout(400);
  await typeProgram(page, "INC AX\nJMP 1\n");
  await page.keyboard.press("Alt+3");
  await page.waitForTimeout(900);
  await shot(page, "08_analysis_loop500.png");
  await page.close();

  await browser.close();
  console.log("screenshots written to", OUT);
})();
