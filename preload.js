// Publishes the mascot's assets instead of fetching them at page load. Two extension-resource requests
// are the expensive half of the widget and most pages never draw it, so the loader is lazy and memoised:
// content.js calls it only when it is about to mount, and the promise is shared between calls.
(() => {
  const assets = (window.__bubuAssets = {css: '', svg: ''});
  const get = p => fetch(chrome.runtime.getURL(p)).then(r => r.ok ? r.text() : '').catch(() => '');
  let loading = null;
  window.__bubuLoadAssets = () => {
    if (assets.css && assets.svg) return Promise.resolve(assets);
    if (loading) return loading;
    loading = Promise.all([get('bear.css'), get('bear.svg')])
      // A content script's fetch runs under the PAGE's origin, so a strict page can answer with empty
      // bodies and the widget would mount a headless bear. The worker reads the same files from an
      // extension context, which the page cannot refuse.
      .then(async ([css0, svg0]) => {
        let css = css0, svg = svg0;
        if (!css || !svg) {
          const a = await chrome.runtime.sendMessage({type: 'DUDU_ASSETS'}).catch(() => null);
          if (a) { css = css || a.css || ''; svg = svg || a.svg || ''; }
        }
        if (!svg) console.warn('[Bubu] bear.svg could not be loaded — the floating bear will have no artwork.');
        assets.css = css; assets.svg = svg;
        return assets;
      })
      .catch(() => { loading = null; return assets; });
    return loading;
  };
})();
