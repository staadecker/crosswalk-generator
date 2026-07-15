<script>
  import { get } from 'svelte/store';
  import {
    systemA,
    systemB,
    mappings,
    exportProject,
    loadProject,
    clearAll,
    canUndoMappings,
    canRedoMappings,
    undoMappings,
    redoMappings,
    helpOpen,
  } from '../lib/stores.js';
  import undoIcon from '@material-design-icons/svg/filled/undo.svg?raw';
  import redoIcon from '@material-design-icons/svg/filled/redo.svg?raw';
  import helpIcon from '@material-design-icons/svg/filled/help_outline.svg?raw';
  import { buildCrosswalkRows, crosswalkToCsv, downloadFile, readFileText } from '../lib/crosswalk.js';
  import { toolbar as strings } from '../lib/strings.js';

  let { mappingCount = 0 } = $props();

  let importEl;
  let message = $state('');
  let citeOpen = $state(false);
  let citeAgreed = $state(false);

  function stamp() {
    return new Date().toISOString().slice(0, 10);
  }

  /** Turn a dataset name into a filesystem/URL-safe slug for filenames. */
  function slug(name) {
    return (name ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /** "<a>-to-<b>" (or a generic fallback) for export filenames. */
  function pairSlug(a, b) {
    const sa = slug(a?.name);
    const sb = slug(b?.name);
    if (!sa && !sb) return 'crosswalk';
    return `${sa || 'a'}-to-${sb || 'b'}`;
  }

  // One export button, one download: a single CSV with one row per code (both
  // sides of every group), sharing a sequential group_number — no format
  // dropdown to choose between, and no zip to unpack.
  function exportCsv() {
    const groups = get(mappings);
    const a = get(systemA);
    const b = get(systemB);
    const pair = pairSlug(a, b);
    const csv = crosswalkToCsv(buildCrosswalkRows(groups, a, b));
    downloadFile(`${pair}-crosswalk-${stamp()}.csv`, csv, 'text/csv');
  }

  // Export itself is gated behind an explicit citation-agreement popup —
  // opening it never exports anything on its own; only confirming it does.
  function openCiteModal() {
    if (!mappingCount) return;
    citeAgreed = false;
    citeOpen = true;
  }

  function closeCiteModal() {
    citeOpen = false;
  }

  function confirmExport() {
    if (!citeAgreed) return;
    exportCsv();
    citeOpen = false;
  }

  function saveProject() {
    const pair = pairSlug(get(systemA), get(systemB));
    downloadFile(`${pair}-project-${stamp()}.json`, exportProject(), 'application/json');
  }

  async function onImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await readFileText(file));
      loadProject(data);
      flash(strings.projectLoaded);
    } catch (err) {
      flash(strings.loadProjectError(err.message ?? err));
    }
  }

  function onClear() {
    if (confirm(strings.restartConfirm)) {
      clearAll();
      flash(strings.restarted);
    }
  }

  function flash(msg) {
    message = msg;
    setTimeout(() => (message = ''), 2500);
  }

  function closeHelp() {
    helpOpen.set(false);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    if ($helpOpen) closeHelp();
    else if (citeOpen) closeCiteModal();
  }}
/>

<div class="toolbar">
  <div class="brand">
    <span class="logo" aria-hidden="true">⇄</span>
    <div>
      <div class="name">{strings.brandName}</div>
      <div class="sub">{strings.tagline}</div>
    </div>
    <button
      class="icon-btn"
      onclick={() => helpOpen.set(true)}
      title={strings.helpTitle}
      aria-label={strings.helpAriaLabel}
    >
      {@html helpIcon}
    </button>
  </div>

  <div class="actions">
    {#if message}<span class="msg" aria-live="polite">{message}</span>{/if}
    <div class="undo-redo">
      <button
        class="icon-btn"
        onclick={undoMappings}
        disabled={!$canUndoMappings}
        title={strings.undoTitle}
        aria-label={strings.undoTitle}
      >
        {@html undoIcon}
      </button>
      <button
        class="icon-btn"
        onclick={redoMappings}
        disabled={!$canRedoMappings}
        title={strings.redoTitle}
        aria-label={strings.redoTitle}
      >
        {@html redoIcon}
      </button>
    </div>
    <button
      onclick={openCiteModal}
      disabled={mappingCount === 0}
      title={strings.exportTitle}
    >
      {strings.exportButton}
    </button>
    <button onclick={saveProject} title={strings.saveProjectTitle}>
      {strings.saveProjectButton}
    </button>
    <button onclick={() => importEl.click()} title={strings.loadProjectTitle}>{strings.loadProjectButton}</button>
    <button class="danger" onclick={onClear} title={strings.restartTitle}>{strings.restartButton}</button>
    <input bind:this={importEl} type="file" accept=".json,application/json" onchange={onImport} hidden />
  </div>
</div>

{#if $helpOpen}
  <div
    class="help-backdrop"
    onclick={(e) => e.target === e.currentTarget && closeHelp()}
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && closeHelp()}
    role="button"
    tabindex="0"
    aria-label={strings.dismissHelpAriaLabel}
  >
    <div class="help-modal" role="dialog" aria-modal="true" aria-label={strings.helpAriaLabel} tabindex="-1">
      <div class="help-head">
        <span class="help-title">{strings.helpHeading}</span>
        <button class="icon-btn" onclick={closeHelp} aria-label={strings.closeHelpAriaLabel}>✕</button>
      </div>
      <div class="help-body">
        {@html strings.helpBodyHtml}
      </div>
    </div>
  </div>
{/if}

{#if citeOpen}
  <div
    class="help-backdrop"
    onclick={(e) => e.target === e.currentTarget && closeCiteModal()}
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && closeCiteModal()}
    role="button"
    tabindex="0"
    aria-label={strings.dismissCiteAriaLabel}
  >
    <div class="help-modal" role="dialog" aria-modal="true" aria-label={strings.citeHeading} tabindex="-1">
      <div class="help-head">
        <span class="help-title">{strings.citeHeading}</span>
        <button class="icon-btn" onclick={closeCiteModal} aria-label={strings.closeCiteAriaLabel}>✕</button>
      </div>
      <div class="help-body">
        <p>{@html strings.citeBodyHtml}</p>
        <label class="cite-agree">
          <input type="checkbox" bind:checked={citeAgreed} />
          {strings.citeAgreeLabel}
        </label>
      </div>
      <div class="cite-actions">
        <button class="ghost" onclick={closeCiteModal}>{strings.cancelButton}</button>
        <button class="primary" disabled={!citeAgreed} onclick={confirmExport}>{strings.confirmExportButton}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .logo {
    font-size: 22px;
    color: var(--accent);
    background: var(--accent-soft);
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 8px;
  }
  .name {
    font-weight: 700;
  }
  .sub {
    font-size: 12px;
    color: var(--text-muted);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .msg {
    font-size: 12px;
    color: var(--text-muted);
    margin-right: 4px;
  }
  .undo-redo {
    display: flex;
    gap: 2px;
    margin-right: 4px;
    padding-right: 8px;
    border-right: 1px solid var(--border);
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border-color: transparent;
    background: transparent;
    color: var(--text-muted);
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }
  .icon-btn :global(svg) {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }
  .help-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 16px;
  }
  .help-modal {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    max-width: 520px;
    width: 100%;
    max-height: 85vh;
    overflow: auto;
  }
  .help-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--surface);
  }
  .help-title {
    font-weight: 700;
    font-size: 14px;
  }
  .help-body {
    padding: 4px 16px 16px;
    font-size: 13px;
    line-height: 1.5;
  }
  .help-body :global(h3) {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin: 16px 0 6px;
  }
  .help-body :global(ol),
  .help-body :global(ul) {
    margin: 0 0 12px;
    padding-left: 20px;
  }
  .help-body :global(li) {
    margin-bottom: 4px;
  }
  .help-body :global(kbd) {
    display: inline-block;
    min-width: 16px;
    text-align: center;
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface-2);
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 12px;
  }
  .cite-agree {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    cursor: pointer;
  }
  .cite-agree input {
    margin-top: 2px;
  }
  .cite-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 0 16px 16px;
  }
</style>
