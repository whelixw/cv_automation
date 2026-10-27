// Injected only after the user requests a selection. No page content is transmitted here.
globalThis.rendercvPickElement = function (options = {}) {
  globalThis.rendercvCancelPicker?.();
  return new Promise((resolve) => {
    let selected = null;
    let finished = false;
    const included = [];
    const excluded = [];
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
    if (options.multiple) shadow.querySelector("#help").textContent =
      "Click to add sections · Alt+click to exclude · ↑ Parent · ↓ Child · Enter Finish · Esc Cancel";

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
      if (excluded.includes(element)) return document.createElement("div");
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
    function selector(element) {
      if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) return `#${CSS.escape(element.id)}`;
      for (const attribute of ["data-testid", "data-job-description", "itemprop", "role"]) {
        if (!element.hasAttribute(attribute)) continue;
        const rule = `${element.localName}[${attribute}="${CSS.escape(element.getAttribute(attribute))}"]`;
        if (document.querySelectorAll(rule).length === 1) return rule;
      }
      const parts = [];
      for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
        const siblings = [...node.parentElement.children].filter(item => item.tagName === node.tagName);
        parts.unshift(`${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`);
      }
      return `html > ${parts.join(" > ")}`;
    }
    function result(elements) {
      // Collapse overlapping selections and preserve page order rather than click order.
      const roots = elements.filter(item => !elements.some(other => other !== item && other.contains(item)))
        .sort((left, right) => left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      return { html: roots.map(item => cleanClone(item).outerHTML).join("\n"),
        text: roots.map(item => item.innerText).join("\n"),
        include: roots.map(selector), exclude: excluded.map(selector),
        url: location.href, cancelled: false };
    }
    function choose() {
      const elements = options.multiple ? included.filter(item => item.isConnected) : [selected].filter(item => item?.isConnected);
      if (!elements.length) return;
      try {
        finish(result(elements));
      } catch (_) {
        finish({ cancelled: true, error: "This section could not be read. Select another section or paste the description." });
      }
    }
    function move(event) { highlight(event.composedPath().find(valid)); }
    function click(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!selected) highlight(event.composedPath().find(valid));
      if (!options.multiple) choose();
      else if (selected) {
        const list = event.altKey ? excluded : included;
        const index = list.indexOf(selected);
        if (index >= 0) list.splice(index, 1); else list.push(selected);
        shadow.querySelector("#help").textContent = `${included.length} sections · ${excluded.length} exclusions. Click to toggle · Alt+click exclude · ↑ Parent · Enter Finish · Esc Cancel`;
      }
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

// Runs in the page's isolated extension world. A broken selector never falls back
// to the whole page: the panel must ask for a new selection instead.
globalThis.rendercvReadRecipe = function (recipe) {
  try {
    const fields = {};
    for (const { field, ...rule } of recipe.rules) {
      const roots = rule.include.map(selector => {
        const matches = document.querySelectorAll(selector);
        if (matches.length !== 1) throw new Error(`The saved ${field} selection has changed (${matches.length} matches).`);
        return matches[0];
      });
      const exclusions = (rule.exclude || []).map(selector => {
        const matches = document.querySelectorAll(selector);
        if (matches.length !== 1) throw new Error("An excluded section has changed.");
        return matches[0];
      });
      const clones = roots.map(root => {
        if (exclusions.some(item => item === root)) throw new Error("A selected section is excluded.");
        if (root.hidden || getComputedStyle(root).display === "none") throw new Error("A selected section is hidden.");
        const copy = root.cloneNode(true);
        const original = [root, ...root.querySelectorAll("*")];
        const copied = [copy, ...copy.querySelectorAll("*")];
        original.forEach((node, index) => {
          const style = getComputedStyle(node);
          if (exclusions.includes(node) || node.hidden || node.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden" || ["SCRIPT", "STYLE", "NOSCRIPT", "NAV", "ASIDE", "FOOTER", "BUTTON", "FORM", "INPUT", "TEXTAREA"].includes(node.tagName)) copied[index].remove();
          for (const attribute of [...copied[index].attributes]) copied[index].removeAttribute(attribute.name);
          if (node.tagName === "A" && /^https?:/i.test(node.href)) copied[index].setAttribute("href", node.href);
        });
        return copy;
      });
      const text = clones.map(node => node.textContent).join("\n").trim();
      if (!text) throw new Error(`The saved ${field} selection is empty.`);
      fields[field] = { html: clones.map(node => node.outerHTML).join("\n"), text };
    }
    return { fields, url: location.href };
  } catch (error) { return { error: error.message, url: location.href }; }
};
