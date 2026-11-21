// api.js - the only file that talks to Python (window.pywebview.api).
// pywebview adds the api object after the page loads and then fires "pywebviewready",
// so every call waits for that first. Calls never throw: errors come back as
// { ok: false, error: "..." }.

const ready = new Promise((resolve) => {
  const done = () => resolve(window.pywebview.api);
  if (window.pywebview && window.pywebview.api && window.pywebview.api.run) done();
  else window.addEventListener("pywebviewready", done, { once: true });
});

async function call(name, ...args) {
  const py = await ready;
  try {
    return await py[name](...args);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export const api = {
  engineStatus: () => call("engine_status"),
  recheckEngine: () => call("recheck_engine"),
  run: (code) => call("run", code),
  openFile: () => call("open_file"),
  saveFile: (code, path) => call("save_file", code, path || null),
  listDemos: () => call("list_demos"),
  loadDemo: (id) => call("load_demo", id),
  saveSession: (session) => call("save_session", session),
  loadSession: () => call("load_session"),
  runDemo: (id) => call("run_demo", id),
  analysis: () => call("analysis"),
  exportTrace: (name) => call("export_trace", name),
};
