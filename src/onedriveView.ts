import {
  listOneDrive,
  getDownloadUrl,
  processOneDriveItem,
  uploadToOneDrive,
  type OneDriveItem,
} from "./onedrive.js";
import { registerOneDriveOpener, unregisterOneDriveOpener, type RevealTarget } from "./navigation.js";

// Mounts the OneDrive section: browse the drive, download files, upload new
// ones (to a "DevPod Uploads" folder), and process files into the vector DB.

interface Crumb {
  id?: string;
  name: string;
}

const SHELL = `
  <div class="onedrive">
    <div class="onedrive-toolbar">
      <nav class="od-breadcrumb" id="od-breadcrumb" aria-label="Folder path"></nav>
      <div class="od-actions">
        <button class="btn btn-secondary btn-sm" id="od-process-all">Process all</button>
        <button class="btn btn-primary btn-sm" id="od-upload-btn">Upload</button>
        <input type="file" id="od-file-input" hidden />
      </div>
    </div>
    <div class="onedrive-status" id="od-status" hidden></div>
    <div class="onedrive-list" id="od-list"><p class="empty-state">Loading…</p></div>
  </div>
`;

export function mountOneDrive(container: HTMLElement): () => void {
  container.innerHTML = SHELL;

  const listEl = container.querySelector<HTMLElement>("#od-list")!;
  const crumbEl = container.querySelector<HTMLElement>("#od-breadcrumb")!;
  const statusEl = container.querySelector<HTMLElement>("#od-status")!;
  const uploadBtn = container.querySelector<HTMLButtonElement>("#od-upload-btn")!;
  const processAllBtn = container.querySelector<HTMLButtonElement>("#od-process-all")!;
  const fileInput = container.querySelector<HTMLInputElement>("#od-file-input")!;

  let trail: Crumb[] = [{ name: "OneDrive" }];
  let items: OneDriveItem[] = [];
  let disposed = false;
  let highlightId: string | null = null;

  function currentFolderId(): string | undefined {
    return trail[trail.length - 1].id;
  }

  function setStatus(msg: string | null, kind: "info" | "error" = "info"): void {
    if (!msg) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      return;
    }
    statusEl.hidden = false;
    statusEl.className = `onedrive-status${kind === "error" ? " error" : ""}`;
    statusEl.textContent = msg;
  }

  function renderCrumbs(): void {
    crumbEl.innerHTML = trail
      .map((c, i) => {
        const last = i === trail.length - 1;
        return last
          ? `<span class="od-crumb current">${escapeHtml(c.name)}</span>`
          : `<button class="od-crumb link" data-depth="${i}">${escapeHtml(c.name)}</button><span class="od-crumb-sep">/</span>`;
      })
      .join("");
    crumbEl.querySelectorAll<HTMLElement>(".od-crumb.link").forEach((b) => {
      b.addEventListener("click", () => {
        trail = trail.slice(0, Number(b.dataset.depth) + 1);
        void load();
      });
    });
  }

  function renderList(): void {
    if (items.length === 0) {
      listEl.innerHTML = `<p class="empty-state">This folder is empty.</p>`;
      return;
    }
    listEl.innerHTML = items.map(rowHtml).join("");

    listEl.querySelectorAll<HTMLElement>(".od-row.folder").forEach((row) => {
      row.addEventListener("click", () => {
        const item = items.find((it) => it.id === row.dataset.id);
        if (!item) return;
        trail.push({ id: item.id, name: item.name });
        void load();
      });
    });
    listEl.querySelectorAll<HTMLButtonElement>(".od-download").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        void download(btn.dataset.id!);
      });
    });
    listEl.querySelectorAll<HTMLButtonElement>(".od-process").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        void process(btn.dataset.id!);
      });
    });

    // Reveal-from-assistant: flash the target row once, then clear.
    if (highlightId) {
      const target = highlightId;
      highlightId = null;
      const row = [...listEl.querySelectorAll<HTMLElement>(".od-row")].find((r) => r.dataset.id === target);
      if (row) {
        row.classList.add("highlight");
        row.scrollIntoView({ block: "center" });
      }
    }
  }

  function rowHtml(it: OneDriveItem): string {
    if (it.isFolder) {
      return `
        <div class="od-row folder" data-id="${it.id}" role="button" tabindex="0">
          <span class="od-icon">📁</span>
          <span class="od-name">${escapeHtml(it.name)}</span>
          <span class="od-meta"></span>
          <span class="od-badges"></span>
          <span class="od-row-actions"></span>
        </div>`;
    }
    const processed = it.processedStatus === "converted";
    const badge = it.processedStatus
      ? `<span class="od-badge ${processed ? "ok" : "warn"}">${processed ? "indexed" : escapeHtml(it.processedStatus)}</span>`
      : `<span class="od-badge muted">not indexed</span>`;
    return `
      <div class="od-row file" data-id="${it.id}">
        <span class="od-icon">📄</span>
        <span class="od-name">${escapeHtml(it.name)}</span>
        <span class="od-meta">${formatSize(it.size)}${it.lastModified ? " · " + formatDate(it.lastModified) : ""}</span>
        <span class="od-badges">${badge}</span>
        <span class="od-row-actions">
          <button class="btn btn-secondary btn-sm od-download" data-id="${it.id}">Download</button>
          <button class="btn btn-secondary btn-sm od-process" data-id="${it.id}">${processed ? "Reprocess" : "Process"}</button>
        </span>
      </div>`;
  }

  let loadSeq = 0;
  async function load(): Promise<void> {
    const seq = ++loadSeq;
    renderCrumbs();
    listEl.innerHTML = `<p class="empty-state">Loading…</p>`;
    try {
      const result = await listOneDrive(currentFolderId());
      if (disposed || seq !== loadSeq) return; // a newer load superseded this one
      items = result;
      renderList();
    } catch (err) {
      if (seq === loadSeq) listEl.innerHTML = `<p class="empty-state">${escapeHtml(errMsg(err))}</p>`;
    }
  }

  async function download(itemId: string): Promise<void> {
    setStatus("Preparing download…");
    try {
      const { downloadUrl, name } = await getDownloadUrl(itemId);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus(null);
    } catch (err) {
      setStatus(errMsg(err), "error");
    }
  }

  async function process(itemId: string): Promise<void> {
    setStatus("Processing…");
    try {
      const { status } = await processOneDriveItem(itemId);
      const it = items.find((i) => i.id === itemId);
      if (it) it.processedStatus = status;
      renderList();
      setStatus(status === "converted" ? "Added to the vector database." : `Processed (${status}).`);
    } catch (err) {
      setStatus(errMsg(err), "error");
    }
  }

  async function processAll(): Promise<void> {
    const targets = items.filter((it) => !it.isFolder && it.processedStatus !== "converted");
    if (targets.length === 0) {
      setStatus("Nothing new to process in this folder.");
      return;
    }
    processAllBtn.disabled = true;
    let done = 0;
    for (const it of targets) {
      if (disposed) break;
      setStatus(`Processing ${done + 1} of ${targets.length}…`);
      try {
        const { status } = await processOneDriveItem(it.id);
        it.processedStatus = status;
      } catch {
        /* keep going; individual failures are non-fatal */
      }
      done++;
      renderList();
    }
    processAllBtn.disabled = false;
    setStatus(`Processed ${done} file${done === 1 ? "" : "s"}.`);
  }

  async function upload(file: File): Promise<void> {
    uploadBtn.disabled = true;
    setStatus(`Uploading ${file.name}…`);
    try {
      const res = await uploadToOneDrive(file);
      setStatus(
        res.processed
          ? `Uploaded and indexed “${file.name}”.`
          : `Uploaded “${file.name}” (indexing pending).`,
      );
      await load();
    } catch (err) {
      const e = err as Error & { needsReconnect?: boolean };
      setStatus(
        e.needsReconnect
          ? "Uploading needs OneDrive write access — reconnect your Microsoft account (Settings) to grant it."
          : errMsg(err),
        "error",
      );
    } finally {
      uploadBtn.disabled = false;
    }
  }

  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) void upload(file);
  });
  processAllBtn.addEventListener("click", () => void processAll());

  // Reveal a file's folder when the assistant's document source is clicked.
  const reveal = (t: RevealTarget) => {
    trail = t.folderId ? [{ name: "OneDrive" }, { id: t.folderId, name: t.folderName ?? "Folder" }] : [{ name: "OneDrive" }];
    highlightId = t.highlightId ?? null;
    void load();
  };
  void load();
  // Register after the default load so a queued reveal supersedes it (loadSeq).
  registerOneDriveOpener(reveal);

  return () => {
    disposed = true;
    unregisterOneDriveOpener(reveal);
  };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function formatSize(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}
