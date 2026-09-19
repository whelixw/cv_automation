const API = "http://127.0.0.1:8765";
const DRAFT_PREFIX = "draft:";
const AUTOMATION_PREFIX = "automation:";
let capturedPage = null;
let currentDraftKey = null;
let currentAutomationKey = null;
let jobDirectory = null;
let currentAutomationPhase = "analyze";

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
      instructions: document.querySelector("#instructions").value,
      answers: document.querySelector("#answers").value
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
    currentAutomationKey = `${AUTOMATION_PREFIX}${result.url}`;
    const stored = await chrome.storage.local.get([currentDraftKey, currentAutomationKey]);
    const draft = stored[currentDraftKey] || {};
    document.querySelector("#title").value = draft.title || result.title;
    document.querySelector("#company").value = draft.company || result.company;
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

for (const id of ["title", "company", "instructions", "answers"]) {
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
