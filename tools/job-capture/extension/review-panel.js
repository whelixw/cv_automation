let reviewDirectory = null;
let reviewData = null;
let applications = [];
let previewUrls = [];
let reviewSequence = 0;

async function reviewApi(path, body) {
  const response = await companionFetch(`${API}${path}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The companion request failed.");
  return data;
}

function reviewMessage(message) { document.querySelector("#review-status").textContent = message; }
function bindReview(id, action) {
  document.querySelector(`#${id}`).addEventListener("click", async () => {
    const button = document.querySelector(`#${id}`);
    button.disabled = true;
    try { await action(); } catch (error) { reviewMessage(error.message); }
    finally { button.disabled = id === "export-final" && reviewData?.application.approvedVersion !== document.querySelector("#review-version").value; }
  });
}
function applicationOptions() {
  const select = document.querySelector("#application-list");
  const previous = select.value;
  select.replaceChildren(new Option("Choose an application", ""));
  const query = document.querySelector("#history-search").value.toLocaleLowerCase();
  for (const app of applications.filter(app => `${app.company} ${app.title}`.toLocaleLowerCase().includes(query))) {
    select.add(new Option(`${app.company || "Unknown company"} — ${app.title} (${app.trackingStatus || app.status})`, app.directory));
  }
  select.value = previous;
}
async function refreshApplicationHistory(directory = null) {
  applications = (await reviewApi("/applications")).applications;
  applicationOptions();
  if (directory) {
    document.querySelector("#history").open = true;
    document.querySelector("#application-list").value = directory;
    await openApplication(directory);
  }
}

async function artifactBlob(directory, version, path) {
  const query = new URLSearchParams({ directory, version, path });
  const response = await companionFetch(`${API}/artifact?${query}`);
  if (!response.ok) throw new Error((await response.json()).error);
  return response.blob();
}

async function openApplication(directory, version = null) {
  const sequence = ++reviewSequence;
  reviewMessage("Loading saved application…");
  const query = new URLSearchParams({ directory });
  if (version) query.set("version", version);
  const data = await reviewApi(`/application?${query}`);
  if (sequence !== reviewSequence) return;
  reviewDirectory = directory;
  reviewData = data;
  previewUrls.forEach(url => URL.revokeObjectURL(url)); previewUrls = [];
  document.querySelector("#document-review").hidden = false;
  document.querySelector("#review-info").textContent = `${data.application.title} — ${data.application.company || ""}. Workflow: ${data.application.status}.`;
  document.querySelector("#tracking-status").value = data.application.trackingStatus || "not_submitted";
  const current = data.manifest?.id || "";
  const versions = [...(data.application.versions || [])].reverse();
  for (const id of ["review-version", "compare-version"]) {
    const select = document.querySelector(`#${id}`); select.replaceChildren();
    for (const item of versions) select.add(new Option(`${item.created} · ${item.id.slice(0, 8)}`, item.id));
    select.value = current;
  }
  if (versions.length > 1) document.querySelector("#compare-version").value = versions.find(item => item.id !== current)?.id;
  document.querySelector("#reviewed-documents").checked = false;
  document.querySelector("#export-final").disabled = !current || data.application.approvedVersion !== current;
  for (const id of ["revise", "approve-final", "compare"]) document.querySelector(`#${id}`).disabled = !current;
  document.querySelector("#version-diff").textContent = "";
  document.querySelector("#document-links").replaceChildren();
  document.querySelector("#page-previews").replaceChildren();
  document.querySelector("#requirements").replaceChildren();
  document.querySelector("#tailoring-notes").textContent = "";
  if (!data.manifest) { reviewMessage("No document version yet. Analyze this saved application to continue."); return; }
  for (const item of data.manifest.requirements.items) {
    const li = document.createElement("li"); li.textContent = `${item.category}: ${item.text}`;
    document.querySelector("#requirements").append(li);
  }
  if (!data.manifest.requirements.items.length) document.querySelector("#requirements").textContent = "No additional requirements recorded. Check the original posting before submission.";
  for (const item of data.manifest.artifacts.filter(item => /\.(pdf|png)$/.test(item.path))) {
    const blob = await artifactBlob(directory, current, item.path);
    if (sequence !== reviewSequence) return;
    const url = URL.createObjectURL(blob); previewUrls.push(url);
    if (item.path.endsWith(".png")) {
      const image = document.createElement("img"); image.src = url; image.alt = item.path; image.loading = "lazy";
      document.querySelector("#page-previews").append(image);
    } else {
      const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener";
      link.textContent = item.path.includes("cover-letter") ? "Open cover-letter PDF" : "Open CV PDF";
      document.querySelector("#document-links").append(link);
    }
  }
  const notes = await artifactBlob(directory, current, "tailoring_notes.md");
  if (sequence !== reviewSequence) return;
  const notesText = await notes.text();
  if (sequence !== reviewSequence) return;
  document.querySelector("#tailoring-notes").textContent = notesText;
  reviewMessage(data.application.approvedVersion === current ? "This version is approved and ready to export." : "Review all pages and requirements before approving this version.");
}

bindReview("refresh-history", () => refreshApplicationHistory());
bindReview("diagnose", async () => {
  const data = await reviewApi("/diagnostics");
  document.querySelector("#diagnostics").textContent = data.checks.map(check => `${check.ok ? "Ready" : "Needs attention"}: ${check.name}\n${check.detail}`).join("\n\n");
});
bindReview("stop-companion", async () => {
  await reviewApi("/companion/stop", {});
  document.querySelector("#connection-status").textContent = "Companion stopped. Restart it from its launcher when ready.";
});
document.querySelector("#history-search").addEventListener("input", applicationOptions);
document.querySelector("#application-list").addEventListener("change", event => {
  if (event.target.value) openApplication(event.target.value).catch(error => reviewMessage(error.message));
});
document.querySelector("#review-version").addEventListener("change", event => openApplication(reviewDirectory, event.target.value).catch(error => reviewMessage(error.message)));
bindReview("save-tracking", async () => {
  await reviewApi("/application/status", { directory: reviewDirectory, status: document.querySelector("#tracking-status").value });
  reviewMessage("Tracking status saved. No application was submitted by the tool.");
});
bindReview("compare", async () => {
  const query = new URLSearchParams({ directory: reviewDirectory, left: document.querySelector("#compare-version").value, right: document.querySelector("#review-version").value });
  document.querySelector("#version-diff").textContent = (await reviewApi(`/compare?${query}`)).diff;
});
bindReview("approve-final", async () => {
  await reviewApi("/application/approve", { directory: reviewDirectory, version: document.querySelector("#review-version").value, reviewed: document.querySelector("#reviewed-documents").checked });
  await openApplication(reviewDirectory, document.querySelector("#review-version").value);
});
bindReview("export-final", async () => {
  const query = new URLSearchParams({ directory: reviewDirectory, version: document.querySelector("#review-version").value });
  const response = await companionFetch(`${API}/export?${query}`);
  if (!response.ok) throw new Error((await response.json()).error);
  const url = URL.createObjectURL(await response.blob()); previewUrls.push(url);
  const link = document.createElement("a"); link.href = url; link.download = "application.zip"; link.click();
});
async function runSaved(phase, notes = "") {
  jobDirectory = reviewDirectory;
  currentAutomationKey = `review:${reviewDirectory}`;
  await startAutomation(phase, notes);
}
bindReview("analyze-saved", () => runSaved("analyze"));
bindReview("revise", () => {
  if (reviewData?.manifest?.id !== reviewData?.application.currentVersion) throw new Error("Select the latest version before requesting a revision.");
  const notes = document.querySelector("#revision-notes").value.trim();
  if (!notes) throw new Error("Describe the revision you want first.");
  return runSaved("revise", notes);
});
