const API = "http://127.0.0.1:8765";
const DRAFT_PREFIX = "draft:";
let capturedPage = null;
let currentDraftKey = null;

function extractJobPage() {
  const clean = (value) => String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  const firstText = (...selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = clean(element?.content || element?.innerText || element?.textContent);
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
  const posting = jobPostings[0];
  const selected = clean(window.getSelection()?.toString());
  const linkedInDescription = document.querySelector(
    ".jobs-description__content, .jobs-box__html-content, .jobs-description-content__text, #job-details"
  );
  const description = selected || clean(posting?.description) || clean(linkedInDescription?.innerText) || clean(document.body.innerText);
  const titleParts = clean(document.title).split(/\s*[|·–]\s*/);
  const titleFromDocument = titleParts[0];
  const detectedTitle = clean(posting?.title) || firstText(
    ".job-details-jobs-unified-top-card__job-title h1",
    ".job-details-jobs-unified-top-card__job-title",
    ".jobs-unified-top-card__job-title",
    ".top-card-layout__title",
    "main h1",
    'meta[property="og:title"]'
  );
  const title = detectedTitle.split(/\s*[|·–]\s*/)[0] || titleFromDocument;
  const company = clean(posting?.hiringOrganization?.name) || firstText(
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
    source: selected ? "selected text" : posting ? "structured job data" : linkedInDescription ? "job description" : "page text"
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
      instructions: document.querySelector("#instructions").value
    }
  });
}

function permissionPattern(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return `${parsed.protocol}//${parsed.host}/*`;
}

async function readCurrentPage(requestAccess = false) {
  setStatus("");
  document.querySelector("#extraction").textContent = "Reading the current page…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    const stored = await chrome.storage.local.get(currentDraftKey);
    const draft = stored[currentDraftKey] || {};
    document.querySelector("#title").value = draft.title || result.title;
    document.querySelector("#company").value = draft.company || result.company;
    document.querySelector("#instructions").value = draft.instructions || "";
    document.querySelector("#extraction").textContent = `Using ${result.source} (${result.description.length.toLocaleString()} characters). Drafts are saved automatically.`;
  } catch (error) {
    capturedPage = null;
    document.querySelector("#extraction").textContent = "Could not read the current page.";
    setStatus(`Click Read current page to grant access to this job site. ${error.message}`, "error");
  }
}

for (const id of ["title", "company", "instructions"]) {
  document.querySelector(`#${id}`).addEventListener("input", saveDraft);
}
document.querySelector("#refresh").addEventListener("click", () => readCurrentPage(true));

document.querySelector("#capture").addEventListener("click", async () => {
  if (!capturedPage) {
    setStatus("Read a job page before capturing it.", "error");
    return;
  }
  const button = document.querySelector("#capture");
  button.disabled = true;
  setStatus("Saving job posting…");
  try {
    await saveDraft();
    const response = await fetch(`${API}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...capturedPage,
        title: document.querySelector("#title").value,
        company: document.querySelector("#company").value,
        instructions: document.querySelector("#instructions").value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`);
    document.querySelector("#prompt").value = data.prompt;
    document.querySelector("#result").hidden = false;
    setStatus(`Saved to ${data.directory}`, "success");
  } catch (error) {
    const hint = error instanceof TypeError ? " Start the local Python server first." : "";
    setStatus(`${error.message}.${hint}`, "error");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(document.querySelector("#prompt").value);
  setStatus("Prompt copied. Paste it into your Codex task.", "success");
});

readCurrentPage();
