// screenshots.js - DEVELOPMENT ONLY. Takes the review screenshots in docs/screens/.
//
// Needs Node + Playwright (Chromium) and two dev servers:
//   python gui/dev/dev_server.py --port 8765            (mock engine)
//   python gui/dev/dev_server.py --port 8766 --missing  (engine not found)
// then:  node gui/dev/screenshots.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "docs", "screens");
const SHIM = path.join(__dirname, "shim.js");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

async function open(browser, port = 8765) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.addInitScript({ path: SHIM });
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.miniCpu && window.miniCpu.state.engine.state !== "checking");
  await page.waitForTimeout(300);
  return page;
}

async function loadDemo(page, index) {
  await page.click("#demosBtn");
  await page.click(`.menu-item >> nth=${index}`);
  await page.waitForFunction(() => window.miniCpu.state.result !== null);
  await page.waitForTimeout(1600);               // let the live replay finish
}

// Type a program the way a user would (live mode then runs it).
async function typeProgram(page, code) {
  await page.evaluate((c) => {
    const cm = document.querySelector(".CodeMirror").CodeMirror;
    cm.replaceRange(c, { line: 0, ch: 0 });
  }, code);
  await page.waitForFunction(() => window.miniCpu.state.result !== null);
  await page.waitForTimeout(1600);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

  // 1. empty state
  let page = await open(browser);
  await shot(page, "01_empty.png");
  await page.close();

  // 2. demo 03 (loop sum) mid-run: step 6 being animated at 0.25x
  page = await open(browser);
  await loadDemo(page, 2);
  await page.evaluate(() => { window.miniCpu.update({ speed: "0.25" }); window.miniCpu.goTo(5); });
  await page.evaluate(() => { window.miniCpu.goTo(6, { animate: true }); });
  await page.waitForTimeout(3450);               // execute phase: write-back + flags
  await shot(page, "02_loop_step6.png");
  await page.close();

  // 3. program with errors (tests/09_errors_1_to_4.txt), hovering an error line
  page = await open(browser);
  await typeProgram(page, read("tests/09_errors_1_to_4.txt"));
  const line = page.locator(".CodeMirror-line >> nth=2");
  const box = await line.boundingBox();
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.waitForTimeout(200);
  await shot(page, "03_errors.png");
  await page.close();

  // 4. HALTED end state after Run (demo 01)
  page = await open(browser);
  await loadDemo(page, 0);
  await page.evaluate(() => window.miniCpu.update({ speed: "2" }));
  await page.click("#runBtn");
  await page.mouse.move(700, 600);               // no hover tooltip in the picture
  await page.waitForFunction(() => window.miniCpu.state.playing, null, { timeout: 5000 });
  await page.waitForFunction(() => !window.miniCpu.state.playing, null, { timeout: 30000 });
  await page.waitForTimeout(900);
  await shot(page, "04_halted.png");

  // 5. help drawer open (same page)
  await page.keyboard.press("F1");
  await page.waitForTimeout(400);
  await shot(page, "05_help.png");
  await page.close();

  // 6. engine missing
  page = await open(browser, 8766);
  await shot(page, "06_engine_missing.png");
  await page.close();

  await browser.close();
  console.log("screenshots written to", OUT);
})();
