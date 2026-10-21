// Injected only after the user requests a selection. No page content is transmitted here.
globalThis.rendercvPickElement = function () {
  globalThis.rendercvCancelPicker?.();
  return new Promise((resolve) => {
    let selected = null;
    let finished = false;
    const host = document.createElement("div");
    host.setAttribute("data-rendercv-picker", "");
    host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
      :host { pointer-events:none; }
      #box { position:fixed; box-sizing:border-box; border:3px solid #2563eb;
        background:rgba(37,99,235,.12); display:none; }
      #help { position:fixed; top:12px; left:12px; max-width:560px;
        padding:12px 16px; border-radius:8px; background:#172554; color:white;
        font:14px/1.5 system-ui,sans-serif; box-shadow:0 2px 12px #0005; }
    </style><div id="box"></div><div id="help" role="status">
      Point to the job description and click to select.<br>
      ↑ Parent · ↓ Child · Enter Select · Esc Cancel
    </div>`;
    document.documentElement.append(host);
    const box = shadow.querySelector("#box");

    function valid(element) {
      return element instanceof Element && element !== host &&
        !["HTML", "BODY", "SCRIPT", "STYLE", "IFRAME"].includes(element.tagName);
    }

    function highlight(element) {
      if (!valid(element)) return;
      selected = element;
      const rect = element.getBoundingClientRect();
      Object.assign(box.style, {
        display: "block", left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`
      });
    }

    function cleanClone(element) {
      const clone = element.cloneNode(false);
      // Keep useful markup and absolute HTTP links, never page attributes or handlers.
      for (const attribute of [...clone.attributes]) clone.removeAttribute(attribute.name);
      if (element.tagName === "A" && /^https?:/i.test(element.href)) clone.setAttribute("href", element.href);
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) clone.append(node.cloneNode());
        else if (node instanceof Element) {
          const style = getComputedStyle(node);
          if (node.hidden || node.getAttribute("aria-hidden") === "true" ||
              style.display === "none" || style.visibility === "hidden" ||
              ["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "BUTTON", "FORM", "INPUT", "TEXTAREA", "SELECT", "NAV", "ASIDE", "FOOTER"].includes(node.tagName)) continue;
          clone.append(cleanClone(node));
        }
      }
      return clone;
    }

    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("pagehide", cancel);
      host.remove();
      delete globalThis.rendercvCancelPicker;
      resolve(result);
    }

    function cancel() { finish({ cancelled: true }); }
    function choose() {
      if (!selected?.isConnected) return;
      try {
        finish({ html: cleanClone(selected).outerHTML, url: location.href, cancelled: false });
      } catch (_) {
        finish({ cancelled: true, error: "This section could not be read. Select another section or paste the description." });
      }
    }
    function move(event) { highlight(event.composedPath().find(valid)); }
    function click(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!selected) highlight(event.composedPath().find(valid));
      choose();
    }
    function key(event) {
      if (!["Escape", "Enter", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") cancel();
      else if (event.key === "Enter") choose();
      else if (event.key === "ArrowUp") highlight(selected?.parentElement);
      else if (event.key === "ArrowDown") highlight(selected?.firstElementChild);
    }
    function reposition() { if (selected) highlight(selected); }
    const timeout = setTimeout(cancel, 120000);
    globalThis.rendercvCancelPicker = cancel;
    document.addEventListener("pointermove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("pagehide", cancel);
  });
};
