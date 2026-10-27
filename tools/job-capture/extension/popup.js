const API = "http://127.0.0.1:8765";
const DRAFT_PREFIX = "draft:";
const AUTOMATION_PREFIX = "automation:";
let capturedPage = null;
let currentDraftKey = null;
let currentAutomationKey = null;
let jobDirectory = null;
let currentAutomationPhase = "analyze";
let selectionRules = {};
let readSequence = 0;
const RECIPES_KEY = "site-recipes:v1";
let activeTaskId = null;

async function companionFetch(url, options = {}) {
  const token = (await chrome.storage.local.get("companionToken")).companionToken || "";
  return fetch(url, { ...options, headers: { ...options.headers, "X-Job-Capture-Token": token,
    "X-Job-Capture-Extension": chrome.runtime?.id || "" } });
}

document.querySelector("#connect").addEventListener("click", async () => {
  const input = document.querySelector("#connection-code");
  try {
    const response = await fetch(`${API}/pair`, { method: "POST", headers: { "X-Job-Capture-Token": input.value.trim() } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    await chrome.storage.local.set({ companionToken: input.value.trim() });
    input.value = "";
    document.querySelector("#connection-status").textContent = "Connected to the local companion.";
  } catch (error) { document.querySelector("#connection-status").textContent = error.message; }
});

document.querySelector("#cancel-run").addEventListener("click", async () => {
  if (!activeTaskId) return;
  const response = await companionFetch(`${API}/automation/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: activeTaskId }) });
  const result = await response.json();
  document.querySelector("#automation-status").textContent = response.ok ? "Cancellation requested…" : result.error;
});

function extractJobPage(picked = null) {
  const cleanInline = (value) => String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|\u00a0/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  const cleanMarkdown = (value) => String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ +([,.;:!?])/g, "$1")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    // LinkedIn sometimes renders its expansion control as ordinary trailing text.
    .replace(/(?:\.{3}|…)\s*more\s*$/i, "")
    .trim();

  const nodeToMarkdown = (node, listDepth = 0) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.nodeValue || "").replace(/\s+/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    if (["script", "style", "noscript", "svg", "button", "form", "dialog", "nav", "footer", "aside"].includes(tag)) return "";
    const children = () => Array.from(node.childNodes)
      .map((child) => nodeToMarkdown(child, listDepth))
      .join("");

    if (tag === "br") return "\n";
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${children().trim()}\n\n`;
    if (tag === "strong" || tag === "b") return `**${children().trim()}**`;
    if (tag === "em" || tag === "i") return `*${children().trim()}*`;
    if (tag === "a") {
      const label = children().trim();
      const href = node.getAttribute("href") || "";
      return label && /^https?:\/\//i.test(href) ? `[${label}](${href})` : label;
    }
    if (tag === "ul" || tag === "ol") {
      const ordered = tag === "ol";
      const items = Array.from(node.children).filter((child) => child.tagName.toLowerCase() === "li");
      return `\n\n${items.map((item, index) => {
        const nestedLists = Array.from(item.children).filter((child) => ["ul", "ol"].includes(child.tagName.toLowerCase()));
        const clone = item.cloneNode(true);
        Array.from(clone.children)
          .filter((child) => ["ul", "ol"].includes(child.tagName.toLowerCase()))
          .forEach((child) => child.remove());
        const content = Array.from(clone.childNodes).map((child) => nodeToMarkdown(child, listDepth + 1)).join("").trim();
        const prefix = ordered ? `${index + 1}.` : "-";
        const nested = nestedLists.map((list) => nodeToMarkdown(list, listDepth + 1).trimEnd()).join("\n");
        return `${"  ".repeat(listDepth)}${prefix} ${content}${nested ? `\n${nested}` : ""}`;
      }).join("\n")}\n\n`;
    }
    if (tag === "li") return children();
    if (tag === "p" || tag === "div" || tag === "section" || tag === "article" || tag === "blockquote") {
      const content = children().trim();
      return content ? `${content}\n\n` : "";
    }
    if (tag === "tr") return `${children().trim()}\n`;
    if (tag === "td" || tag === "th") return `${children().trim()} | `;
    return children();
  };

  const elementToMarkdown = (element) => {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll([
      "script", "style", "noscript", "svg", "button", "form", "dialog",
      "nav", "footer", "aside",
      "[hidden]", "[aria-hidden='true']", ".visually-hidden", ".artdeco-button"
    ].join(",")).forEach((item) => item.remove());
    return cleanMarkdown(nodeToMarkdown(clone));
  };

  const htmlToMarkdown = (value) => {
    const documentFragment = new DOMParser().parseFromString(String(value || ""), "text/html");
    return elementToMarkdown(documentFragment.body);
  };

  const firstText = (...selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = cleanInline(element?.content || element?.innerText || element?.textContent);
      if (value) return value;
    }
    return "";
  };
  const jobPostings = [];
  const collectPosting = (value) => {
    if (!value || typeof value !== "object") return;
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.includes("JobPosting")) jobPostings.push(value);
    if (Array.isArray(value["@graph"])) value["@graph"].forEach(collectPosting);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent);
      (Array.isArray(parsed) ? parsed : [parsed]).forEach(collectPosting);
    } catch (_) { /* Ignore malformed third-party metadata. */ }
  }
  const posting = jobPostings.sort((left, right) =>
    cleanInline(right.description).length - cleanInline(left.description).length
  )[0];
  const selection = window.getSelection();
  let selected = picked?.html ? htmlToMarkdown(picked.html) : "";
  if (!picked && selection && !selection.isCollapsed && selection.rangeCount) {
    const container = document.createElement("div");
    for (let index = 0; index < selection.rangeCount; index += 1) {
      container.append(selection.getRangeAt(index).cloneContents());
    }
    selected = elementToMarkdown(container) || cleanMarkdown(selection.toString());
  }
  const descriptionSelectors = [
    "#job-details",
    ".jobs-description__content",
    ".jobs-description__container",
    ".jobs-box__html-content",
    ".jobs-description-content__text",
    "[data-job-description]",
    "[itemprop='description']",
    "[data-testid*='job-description']",
    "[class*='job-description']"
  ];
  let jobDescription = null;
  for (const selector of descriptionSelectors) {
    const candidates = Array.from(document.querySelectorAll(selector))
      .map((element) => ({ element, length: cleanInline(element.innerText || element.textContent).length }))
      .filter((candidate) => candidate.length >= 120)
      .sort((left, right) => right.length - left.length);
    if (candidates.length) {
      jobDescription = candidates[0].element;
      break;
    }
  }
  let linkedInFallback = "";
  if (/(^|\.)linkedin\.com$/i.test(location.hostname)) {
    const pageText = String(document.body.innerText || "").replace(/\r\n?/g, "\n");
    const startMatch = /(?:^|\n)About the job\s*(?:\n|$)/i.exec(pageText);
    if (startMatch) {
      const start = startMatch.index + startMatch[0].length;
      const remainder = pageText.slice(start);
      const endMarkers = [
        /(?:^|\n)See how you compare to others who clicked apply\s*(?:\n|$)/i,
        /(?:^|\n)About the company\s*(?:\n|$)/i,
        /(?:^|\n)People also viewed\s*(?:\n|$)/i,
        /(?:^|\n)Similar jobs\s*(?:\n|$)/i
      ];
      const endings = endMarkers
        .map((pattern) => pattern.exec(remainder)?.index)
        .filter((index) => Number.isInteger(index));
      linkedInFallback = cleanMarkdown(remainder.slice(0, endings.length ? Math.min(...endings) : undefined));
    }
  }
  const structuredDescription = posting?.description ? htmlToMarkdown(posting.description) : "";
  const description = selected || structuredDescription || elementToMarkdown(jobDescription) || linkedInFallback || cleanMarkdown(document.body.innerText);
  const titleParts = cleanInline(document.title).split(/\s*[|·–]\s*/);
  const titleFromDocument = titleParts[0];
  const detectedTitle = cleanInline(posting?.title) || firstText(
    ".job-details-jobs-unified-top-card__job-title h1",
    ".job-details-jobs-unified-top-card__job-title",
    ".jobs-unified-top-card__job-title",
    ".top-card-layout__title",
    "main h1",
    'meta[property="og:title"]'
  );
  const title = detectedTitle.split(/\s*[|·–]\s*/)[0] || titleFromDocument;
  const company = cleanInline(posting?.hiringOrganization?.name) || firstText(
    ".job-details-jobs-unified-top-card__company-name a",
    ".job-details-jobs-unified-top-card__company-name",
    ".jobs-unified-top-card__company-name",
    ".topcard__org-name-link",
    ".top-card-layout__card a[data-tracking-control-name*='company']",
    "[data-company-name]"
  ) || titleParts[1] || "";
  return {
    title,
    company,
    description,
    url: location.href,
    source: selected ? "selected text" : structuredDescription ? "structured job data" : jobDescription ? "job description" : linkedInFallback ? "LinkedIn job section" : "page text"
  };
}

function setStatus(message, type = "") {
  const status = document.querySelector("#status");
  status.textContent = message;
  status.className = type;
}

async function saveDraft() {
  if (!currentDraftKey) return;
  await chrome.storage.local.set({
    [currentDraftKey]: {
      title: document.querySelector("#title").value,
      company: document.querySelector("#company").value,
      instructions: document.querySelector("#instructions").value,
      description: document.querySelector("#description").value,
      selectionRules,
      answers: document.querySelector("#answers").value
    }
  });
}

function permissionPattern(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    throw new Error("Chrome did not provide this tab's address. Reload the extension in chrome://extensions, reopen the side panel, and try again.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return `${parsed.protocol}//${parsed.host}/*`;
}

async function activeJobTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !Number.isInteger(tab.id)) throw new Error("No active browser tab was found. Open a job posting and try again.");
  if (!permissionPattern(tab.url)) throw new Error("Open a job posting on an HTTP or HTTPS page first.");
  return tab;
}

async function readCurrentPage(requestAccess = false) {
  const sequence = ++readSequence;
  setStatus("");
  document.querySelector("#extraction").textContent = "Reading the current page…";
  try {
    const tab = await activeJobTab();
    const pattern = permissionPattern(tab.url);
    if (requestAccess && pattern) {
      const alreadyAllowed = await chrome.permissions.contains({ origins: [pattern] });
      if (!alreadyAllowed) {
        const allowed = await chrome.permissions.request({ origins: [pattern] });
        if (!allowed) throw new Error("Page access was not granted.");
      }
    }
    let [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJobPage });
    const url = new URL(result.url);
    const recipes = (await chrome.storage.local.get(RECIPES_KEY))[RECIPES_KEY] || [];
    const matches = recipes.filter(recipe => recipe.enabled && recipe.hostname === url.hostname &&
      new RegExp(`^${recipe.path_pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(url.pathname));
    let pageRules = {};
    let recipeMessage = "";
    if (matches.length > 1) { recipeMessage = "Several site rules match. Disable extras before applying one."; result.description = ""; }
    else if (matches.length === 1) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["picker.js"] });
      const [{ result: saved }] = await chrome.scripting.executeScript({ target: { tabId: tab.id },
        func: recipe => globalThis.rendercvReadRecipe(recipe), args: [matches[0]] });
      if (saved.error || saved.url !== result.url) recipeMessage = saved.error || "The page changed. Read it again.";
      else {
        if (saved.fields.description) {
          const [{ result: extracted }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJobPage, args: [saved.fields.description] });
          if (extracted.source !== "selected text" || !extracted.description.trim()) throw new Error("The saved description is empty. Select it again.");
          result.description = extracted.description;
        }
        for (const field of ["title", "company"]) if (saved.fields[field]) result[field] = saved.fields[field].text;
        result.source = "saved site rule";
        pageRules = Object.fromEntries(matches[0].rules.map(({ field, ...rule }) => [field, rule]));
        recipeMessage = "Applied saved site rule. Review all fields before capturing.";
      }
      // A broken recipe must not silently capture a generic page fallback.
      if (saved.error) result.description = "";
    }
    if (sequence !== readSequence) return;
    const active = await activeJobTab();
    if (active.id !== tab.id || active.url !== result.url) throw new Error("The page changed. Read the current page again.");
    capturedPage = result;
    selectionRules = pageRules;
    currentDraftKey = `${DRAFT_PREFIX}${result.url}`;
    currentAutomationKey = `${AUTOMATION_PREFIX}${result.url}`;
    jobDirectory = null;
    document.querySelector("#automation").hidden = true;
    document.querySelector("#approval").hidden = true;
    document.querySelector("#retry").hidden = true;
    document.querySelector("#cancel-run").hidden = true;
    const stored = await chrome.storage.local.get([currentDraftKey, currentAutomationKey]);
    const draft = stored[currentDraftKey] || {};
    selectionRules = draft.selectionRules || selectionRules;
    document.querySelector("#recipe-path").value = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1) + "*";
    document.querySelector("#recipe-status").textContent = recipeMessage;
    await showRecipes(url.hostname);
    document.querySelector("#title").value = draft.title || result.title;
    document.querySelector("#company").value = draft.company || result.company;
    document.querySelector("#description").value = recipeMessage && result.description === "" ? "" : draft.description ?? result.description;
    document.querySelector("#confirm-description").checked = false;
    document.querySelector("#instructions").value = draft.instructions || "";
    document.querySelector("#answers").value = draft.answers || "";
    document.querySelector("#extraction").textContent = `Using ${result.source} (${result.description.length.toLocaleString()} characters). Drafts are saved automatically.`;
    const automation = stored[currentAutomationKey];
    if (automation) {
      jobDirectory = automation.directory;
      currentAutomationPhase = automation.phase;
      document.querySelector("#automation").hidden = false;
      document.querySelector("#automation-title").textContent = automation.phase !== "analyze" ? "Generation result" : "Tailoring analysis";
      document.querySelector("#automation-output").value = automation.result || "";
      if (automation.status === "complete" && automation.phase === "analyze") {
        document.querySelector("#generate").disabled = false;
        document.querySelector("#approval").hidden = false;
      } else if (automation.status === "running" || automation.status === "queued") {
        pollAutomation(automation.taskId, automation.phase);
      } else if (["failed", "cancelled", "interrupted"].includes(automation.status)) {
        document.querySelector("#retry").textContent = automation.phase === "generate" ? "Retry generation" : "Retry analysis";
        document.querySelector("#retry").hidden = false;
      }
    }
  } catch (error) {
    if (sequence !== readSequence) return;
    capturedPage = null;
    document.querySelector("#extraction").textContent = "Could not read the current page.";
    setStatus(`Click Read current page to grant access to this job site. ${error.message}`, "error");
  }
}

async function showRecipes(hostname) {
  const container = document.querySelector("#recipes");
  container.replaceChildren();
  const recipes = (await chrome.storage.local.get(RECIPES_KEY))[RECIPES_KEY] || [];
  for (const recipe of recipes.filter(item => item.hostname === hostname)) {
    const row = document.createElement("div");
    const toggle = document.createElement("button");
    toggle.className = "secondary";
    toggle.textContent = `${recipe.enabled ? "Disable" : "Enable"} ${recipe.path_pattern}`;
    toggle.onclick = async () => {
      recipe.enabled = !recipe.enabled;
      await chrome.storage.local.set({ [RECIPES_KEY]: recipes });
      await showRecipes(hostname);
    };
    const remove = document.createElement("button");
    remove.className = "secondary";
    remove.textContent = `Delete ${recipe.path_pattern}`;
    remove.onclick = async () => {
      await chrome.storage.local.set({ [RECIPES_KEY]: recipes.filter(item => item.id !== recipe.id) });
      await showRecipes(hostname);
    };
    row.append(toggle, remove); container.append(row);
  }
}

document.querySelector("#save-recipe").addEventListener("click", async () => {
  try {
    if (!capturedPage || !selectionRules.description) throw new Error("Select a description on the page first. Typed edits cannot be saved as page rules.");
    const active = await activeJobTab();
    if (active.url !== capturedPage.url) throw new Error("The page changed. Read and select it again.");
    const url = new URL(capturedPage.url);
    const path = document.querySelector("#recipe-path").value.trim();
    if (!path.startsWith("/") || path.length > 500) throw new Error("Use a path such as /jobs/*.");
    const recipes = (await chrome.storage.local.get(RECIPES_KEY))[RECIPES_KEY] || [];
    const old = recipes.find(item => item.hostname === url.hostname && item.path_pattern === path);
    const recipe = { schema_version: 1, id: old?.id || crypto.randomUUID(), revision: (old?.revision || 0) + 1,
      hostname: url.hostname, path_pattern: path, rules: Object.entries(selectionRules).map(([field, rule]) => ({ field, ...rule })), enabled: true };
    await chrome.storage.local.set({ [RECIPES_KEY]: [...recipes.filter(item => item.id !== recipe.id), recipe] });
    await showRecipes(url.hostname);
    document.querySelector("#recipe-status").textContent = "Saved locally. Open another matching posting and click Read current page to apply it.";
  } catch (error) { document.querySelector("#recipe-status").textContent = error.message; }
});

async function rememberAutomation(value, key = currentAutomationKey) {
  if (key) await chrome.storage.local.set({ [key]: value });
}

async function pollAutomation(taskId, phase, scope = currentAutomationKey) {
  if (scope !== currentAutomationKey) return;
  activeTaskId = taskId;
  currentAutomationPhase = phase;
  const statusElement = document.querySelector("#automation-status");
  document.querySelector("#automation").hidden = false;
  document.querySelector("#approval").hidden = true;
  document.querySelector("#retry").hidden = true;
  statusElement.textContent = phase === "analyze" ? "Codex is analyzing the application…" : "Codex is generating and rendering the documents…";
  try {
    const response = await companionFetch(`${API}/automation/status?id=${encodeURIComponent(taskId)}`);
    const data = await response.json();
    if (scope !== currentAutomationKey) return;
    if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`);
    const task = data.task;
    if (["queued", "running", "cancelling"].includes(task.status)) {
      document.querySelector("#cancel-run").hidden = false;
      statusElement.textContent = task.message || `Run ${task.status}…`;
      await rememberAutomation({ taskId, phase, directory: task.directory || jobDirectory, status: task.status, result: "" }, scope);
      setTimeout(() => pollAutomation(taskId, phase, scope), 2000);
      return;
    }
    document.querySelector("#cancel-run").hidden = true;
    if (["failed", "cancelled", "interrupted"].includes(task.status)) throw new Error(task.error || `Run ${task.status}.`);
    document.querySelector("#automation-output").value = task.result;
    statusElement.textContent = phase === "analyze" ? "Analysis complete. Review it before approving generation." : "Generation finished. Review the files listed below.";
    if (phase === "analyze") document.querySelector("#generate").disabled = false;
    document.querySelector("#approval").hidden = phase !== "analyze";
    await rememberAutomation({ taskId, phase, directory: task.directory || jobDirectory, status: "complete", result: task.result }, scope);
    if (phase !== "analyze" && typeof refreshApplicationHistory === "function") {
      refreshApplicationHistory(task.directory || jobDirectory).catch(error => reviewMessage(error.message));
    }
  } catch (error) {
    if (scope !== currentAutomationKey) return;
    document.querySelector("#cancel-run").hidden = true;
    statusElement.textContent = `Automation error: ${error.message}`;
    document.querySelector("#retry").textContent = phase === "generate" ? "Retry generation" : "Retry analysis";
    document.querySelector("#retry").hidden = false;
    await rememberAutomation({ taskId, phase, directory: jobDirectory, status: "failed", result: error.message });
  }
}

async function startAutomation(phase, answers = "", directory = jobDirectory, scope = currentAutomationKey) {
  currentAutomationPhase = phase;
  if (phase === "analyze") document.querySelector("#generate").disabled = false;
  document.querySelector("#automation").hidden = false;
  document.querySelector("#automation-title").textContent = phase !== "analyze" ? "Generation result" : "Tailoring analysis";
  document.querySelector("#automation-output").value = "";
  document.querySelector("#approval").hidden = true;
  document.querySelector("#retry").hidden = true;
  const response = await companionFetch(`${API}/automation/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phase, directory, answers, requestId: crypto.randomUUID() })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`);
  await rememberAutomation({ taskId: data.task.id, phase, directory, status: "queued", result: "" }, scope);
  pollAutomation(data.task.id, phase, scope);
}

for (const id of ["title", "company", "instructions", "answers", "description"]) {
  document.querySelector(`#${id}`).addEventListener("input", saveDraft);
}

for (const id of ["title", "company", "description"]) {
  document.querySelector(`#${id}`).addEventListener("input", () => {
    document.querySelector("#confirm-description").checked = false;
  });
}

document.querySelector("#pick").addEventListener("click", async () => {
  const button = document.querySelector("#pick");
  button.disabled = true;
  try {
    const field = document.querySelector("#pick-field").value;
    const tab = await activeJobTab();
    const pattern = permissionPattern(tab.url);
    if (!pattern) throw new Error("Open a job posting on an HTTP or HTTPS page first.");
    if (!await chrome.permissions.contains({ origins: [pattern] }) &&
        !await chrome.permissions.request({ origins: [pattern] })) {
      throw new Error("Page access was not granted.");
    }
    setStatus(field === "description" ? "Click sections to include; Alt+click to exclude. Press Enter when finished, or Esc to cancel." : `Click the ${field} on the page, or Esc to cancel.`);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["picker.js"] });
    const [{ result: picked }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: options => globalThis.rendercvPickElement(options), args: [{ multiple: field === "description" }]
    });
    if (!picked || picked.cancelled) {
      setStatus(picked?.error || "Selection cancelled. Your draft is unchanged.");
      return;
    }
    const active = await activeJobTab();
    if (active.id !== tab.id || active.url !== picked.url) throw new Error("The page changed. Select the description again.");
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: extractJobPage, args: [picked]
    });
    if (result.url !== picked.url) throw new Error("The page changed. Select the description again.");
    // Empty selections must not silently fall back to capturing the whole page.
    if (!result.description.trim() || result.source !== "selected text") {
      throw new Error("This section contains no readable description. Select a larger section or paste the text.");
    }
    if (capturedPage?.url !== result.url) {
      await readCurrentPage();
      if (capturedPage?.url !== result.url) throw new Error("Read the current page and try again.");
    }
    if (field === "description") capturedPage = { ...capturedPage, description: result.description, source: "visual selection" };
    document.querySelector(`#${field}`).value = field === "description" ? result.description : picked.text.trim();
    selectionRules[field] = { include: picked.include, exclude: picked.exclude };
    document.querySelector("#confirm-description").checked = false;
    document.querySelector("#extraction").textContent = `Using your visual selection (${result.description.length.toLocaleString()} characters).`;
    await saveDraft();
    setStatus("Selection ready. Review the description, role, and company before capturing.", "success");
  } catch (error) {
    setStatus(`Could not select this page: ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#refresh").addEventListener("click", () => readCurrentPage(true));

document.querySelector("#capture").addEventListener("click", async () => {
  if (!capturedPage) {
    setStatus("Read a job page before capturing it.", "error");
    return;
  }
  if (!document.querySelector("#description").value.trim()) {
    setStatus("Select or paste a job description before capturing.", "error");
    return;
  }
  if (!document.querySelector("#confirm-description").checked) {
    setStatus("Check the role, company, and description, then confirm your review.", "error");
    return;
  }
  const button = document.querySelector("#capture");
  const capturedUrl = capturedPage.url;
  button.disabled = true;
  setStatus("Saving job posting…");
  try {
    const active = await activeJobTab();
    if (active.url !== capturedPage.url) throw new Error("The page changed. Read the current page before capturing.");
    await saveDraft();
    const response = await companionFetch(`${API}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...capturedPage,
        description: document.querySelector("#description").value.trim(),
        title: document.querySelector("#title").value,
        company: document.querySelector("#company").value,
        instructions: document.querySelector("#instructions").value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`);
    document.querySelector("#prompt").value = data.prompt;
    document.querySelector("#result").hidden = false;
    jobDirectory = data.directory;
    currentAutomationKey = `${AUTOMATION_PREFIX}${capturedUrl}`;
    setStatus(`Saved to ${data.directory}. Starting analysis…`, "success");
    await startAutomation("analyze");
  } catch (error) {
    const hint = error instanceof TypeError ? " Start the local Python server first." : "";
    setStatus(`${error.message}.${hint}`, "error");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#generate").addEventListener("click", async () => {
  const button = document.querySelector("#generate");
  button.disabled = true;
  try {
    await startAutomation("generate", document.querySelector("#answers").value);
  } catch (error) {
    document.querySelector("#automation-status").textContent = `Could not start generation: ${error.message}`;
    button.disabled = false;
  }
});

document.querySelector("#retry").addEventListener("click", async () => {
  try {
    const answers = currentAutomationPhase === "generate" ? document.querySelector("#answers").value : "";
    await startAutomation(currentAutomationPhase, answers);
  } catch (error) {
    document.querySelector("#automation-status").textContent = `Could not retry analysis: ${error.message}`;
  }
});

document.querySelector("#copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(document.querySelector("#prompt").value);
  setStatus("Prompt copied. Paste it into your Codex task.", "success");
});

readCurrentPage();
