/**
 * Wraps window.electronAPI so every IPC call toggles #apiLoaderOverlay (reference count).
 * Also exposes beginAppLoading / endAppLoading so multi-step "load data" flows stay covered
 * between IPC calls (no flicker).
 * Include after preload exposes electronAPI, before app scripts (renderer.js / sheets.js).
 */
(function installApiLoader() {
  const raw = window.electronAPI;
  if (!raw || raw.__apiLoaderInstalled) return;

  let depth = 0;
  function syncOverlay() {
    const el = document.getElementById('apiLoaderOverlay');
    if (!el) return;
    el.classList.toggle('show', depth > 0);
    el.setAttribute('aria-hidden', depth > 0 ? 'false' : 'true');
  }

  window.beginAppLoading = function beginAppLoading() {
    depth += 1;
    syncOverlay();
  };
  window.endAppLoading = function endAppLoading() {
    depth = Math.max(0, depth - 1);
    syncOverlay();
  };

  const wrapped = { __apiLoaderInstalled: true };
  for (const key of Object.keys(raw)) {
    const val = raw[key];
    if (typeof val !== 'function') {
      wrapped[key] = val;
      continue;
    }
    wrapped[key] = function (...args) {
      depth += 1;
      syncOverlay();
      return Promise.resolve(val.apply(raw, args)).finally(() => {
        depth = Math.max(0, depth - 1);
        syncOverlay();
      });
    };
  }
  window.electronAPI = wrapped;
})();
