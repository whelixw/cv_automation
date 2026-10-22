const API = "http://127.0.0.1:8765";
const DRAFT_PREFIX = "draft:";
const AUTOMATION_PREFIX = "automation:";
let capturedPage = null;
let currentDraftKey = null;
let currentAutomationKey = null;
let jobDirectory = null;
let currentAutomationPhase = "analyze";

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
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJobPage });
    capturedPage = result;
    currentDraftKey = `${DRAFT_PREFIX}${result.url}`;
    currentAutomationKey = `${AUTOMATION_PREFIX}${result.url}`;
    const stored = await chrome.storage.local.get([currentDraftKey, currentAutomationKey]);
    const draft = stored[currentDraftKey] || {};
    document.querySelector("#title").value = draft.title || result.title;
    document.querySelector("#company").value = draft.company || result.company;
    document.querySelector("#description").value = draft.description ?? result.description;
    document.querySelector("#confirm-description").checked = false;
    document.querySelector("#instructions").value = draft.instructions || "";
    document.querySelector("#answers").value = draft.answers || "";
    document.querySelector("#extraction").textContent = `Using ${result.source} (${result.description.length.toLocaleString()} characters). Drafts are saved automatically.`;
    const automation = stored[currentAutomationKey];
    if (automation) {
      jobDirectory = automation.directory;
      currentAutomationPhase = automation.phase;
      document.querySelector("#automation").hidden = false;
      document.querySelector("#automation-title").textContent = automation.phase === "generate" ? "Generation result" : "Tailoring analysis";
      document.querySelector("#automation-output").value = automation.result || "";
      if (automation.status === "complete" && automation.phase === "analyze") {
        document.querySelector("#generate").disabled = false;
        document.querySelector("#approval").hidden = false;
      } else if (automation.status === "running" || automation.status === "queued") {
        pollAutomation(automation.taskId, automation.phase);
      } else if (automation.status === "failed") {
        document.querySelector("#retry").textContent = automation.phase === "generate" ? "Retry generation" : "Retry analysis";
        document.querySelector("#retry").hidden = false;
      }
    }
  } catch (error) {
    capturedPage = null;
    document.querySelector("#extraction").textContent = "Could not read the current page.";
    setStatus(`Click Read current page to grant access to this job site. ${error.message}`, "error");
  }
}

async function rememberAutomation(value) {
  if (currentAutomationKey) await chrome.storage.local.set({ [currentAutomationKey]: value });
}

async function pollAutomation(taskId, phase) {
  currentAutomationPhase = phase;
  const statusElement = document.querySelector("#automation-status");
  document.querySelector("#automation").hidden = false;
  document.querySelector("#approval").hidden = true;
  document.querySelector("#retry").hidden = true;
  statusElement.textContent = phase === "analyze" ? "Codex is analyzing the application…" : "Codex is generating and rendering the documents…";
  try {
    const response = await fetch(`${API}/automation/status?id=${encodeURIComponent(taskId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`);
    const task = data.task;
    if (task.status === "queued" || task.status === "running") {
      await rememberAutomation({ taskId, phase, directory: jobDirectory, status: task.status, result: "" });
      setTimeout(() => pollAutomation(taskId, phase), 2000);
      return;
    }
    if (task.status === "failed") throw new Error(task.error || "Codex automation failed.");
    document.querySelector("#automation-output").value = task.result;
    statusElement.textContent = phase === "analyze" ? "Analysis complete. Review it before approving generation." : "Generation finished. Review the files listed below.";
    if (phase === "analyze") document.querySelector("#generate").disabled = false;
    document.querySelector("#approval").hidden = phase !== "analyze";
    await rememberAutomation({ taskId, phase, directory: jobDirectory, status: "complete", result: task.result });
  } catch (error) {
    statusElement.textContent = `Automation error: ${error.message}`;
    document.querySelector("#retry").textContent = phase === "generate" ? "Retry generation" : "Retry analysis";
    document.querySelector("#retry").hidden = false;
    await rememberAutomation({ taskId, phase, directory: jobDirectory, status: "failed", result: error.message });
  }
}

async function startAutomation(phase, answers = "") {
  currentAutomationPhase = phase;
  if (phase === "analyze") document.querySelector("#generate").disabled = false;
  document.querySelector("#automation").hidden = false;
  document.querySelector("#automation-title").textContent = phase === "generate" ? "Generation result" : "Tailoring analysis";
  document.querySelector("#automation-output").value = "";
  document.querySelector("#approval").hidden = true;
  document.querySelector("#retry").hidden = true;
  const response = await fetch(`${API}/automation/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phase, directory: jobDirectory, answers })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`);
  await rememberAutomation({ taskId: data.task.id, phase, directory: jobDirectory, status: "queued", result: "" });
  pollAutomation(data.task.id, phase);
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
    const tab = await activeJobTab();
    const pattern = permissionPattern(tab.url);
    if (!pattern) throw new Error("Open a job posting on an HTTP or HTTPS page first.");
    if (!await chrome.permissions.contains({ origins: [pattern] }) &&
        !await chrome.permissions.request({ origins: [pattern] })) {
      throw new Error("Page access was not granted.");
    }
    setStatus("Point to the description on the page. Use ↑ for a larger section, Enter to select, or Esc to cancel.");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["picker.js"] });
    const [{ result: picked }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: () => globalThis.rendercvPickElement()
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
    capturedPage = { ...result, source: "visual selection" };
    document.querySelector("#description").value = result.description;
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
  button.disabled = true;
  setStatus("Saving job posting…");
  try {
    const active = await activeJobTab();
    if (active.url !== capturedPage.url) throw new Error("The page changed. Read the current page before capturing.");
    await saveDraft();
    const response = await fetch(`${API}/capture`, {
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
