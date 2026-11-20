// shim.js - DEVELOPMENT ONLY. Injected by gui/dev/screenshots.py into a normal browser.
// Fakes window.pywebview.api by forwarding every call to gui/dev/dev_server.py.
window.pywebview = {
  api: new Proxy({}, {
    // "then" must be undefined, or `await api` would treat the proxy as a Promise.
    get: (_, name) => (name === "then" ? undefined : (...args) =>
      fetch("/__api/" + String(name), { method: "POST", body: JSON.stringify(args) })
        .then((r) => r.json())),
  }),
};
window.addEventListener("DOMContentLoaded", () =>
  setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 0));
