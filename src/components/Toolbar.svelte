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
  import {
    buildCrosswalkRows,
    crosswalkToCsv,
    buildAToNameRows,
    aToNameCsv,
    buildNameToBRows,
    nameToBCsv,
    downloadFile,
    downloadBlob,
    readFileText,
  } from '../lib/crosswalk.js';
  import { buildZip } from '../lib/zip.js';

  let { mappingCount = 0 } = $props();

  let importEl;
  let message = $state('');

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

  // One export button, one download: a zip bundling all three crosswalk
  // representations (the N×N cross-product, plus the two normalized
  // A→name / name→B files) — no format dropdown to choose between, and no
  // browser multiple-automatic-download blocking to work around since it's a
  // single file.
  function exportCsv() {
    const groups = get(mappings);
    if (!groups.length) {
      flash('Nothing to export yet.');
      return;
    }
    const a = get(systemA);
    const b = get(systemB);
    const pair = pairSlug(a, b);
    const crosswalkCsv = crosswalkToCsv(buildCrosswalkRows(groups, a, b));
    const zip = buildZip([
      { name: 'crosswalk.csv', content: crosswalkCsv },
      { name: 'a-to-name.csv', content: aToNameCsv(buildAToNameRows(groups, a)) },
      { name: 'name-to-b.csv', content: nameToBCsv(buildNameToBRows(groups, b)) },
    ]);
    downloadBlob(`${pair}-crosswalk-${stamp()}.zip`, zip);
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
      flash('Project loaded.');
    } catch (err) {
      flash(`Could not load project: ${err.message ?? err}`);
    }
  }

  function onClear() {
    if (confirm('Clear both systems and all mappings? This cannot be undone.')) {
      clearAll();
      flash('Cleared.');
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

<svelte:window onkeydown={(e) => e.key === 'Escape' && $helpOpen && closeHelp()} />

<div class="toolbar">
  <div class="brand">
    <span class="logo" aria-hidden="true">⇄</span>
    <div>
      <div class="name">Crosswalk Generator</div>
      <div class="sub">Create a mapping table between two hierarchical classification systems</div>
    </div>
    <button
      class="icon-btn"
      onclick={() => helpOpen.set(true)}
      title="Help — what this tool does and how to use it"
      aria-label="Help"
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
        title="Undo last mapping change"
        aria-label="Undo last mapping change"
      >
        {@html undoIcon}
      </button>
      <button
        class="icon-btn"
        onclick={redoMappings}
        disabled={!$canRedoMappings}
        title="Redo last undone mapping change"
        aria-label="Redo last undone mapping change"
      >
        {@html redoIcon}
      </button>
    </div>
    <button
      onclick={exportCsv}
      disabled={mappingCount === 0}
      title="Download a .zip with the full crosswalk (N×N), plus A→name and name→B CSVs"
    >
      Export crosswalk (.zip)
    </button>
    <button onclick={saveProject} title="Save systems + mappings as a reloadable JSON file">
      Save project
    </button>
    <button onclick={() => importEl.click()} title="Load a saved project JSON">Load project</button>
    <button class="danger" onclick={onClear} title="Remove everything">Clear</button>
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
    aria-label="Dismiss help"
  >
    <div class="help-modal" role="dialog" aria-modal="true" aria-label="Help" tabindex="-1">
      <div class="help-head">
        <span class="help-title">How Crosswalk Generator works</span>
        <button class="icon-btn" onclick={closeHelp} aria-label="Close help">✕</button>
      </div>
      <div class="help-body">
        <p>
          Hierarchical classification systems are widely used to organize books,
          define industries, and classify patents, among other things. When two
          conflicting systems need to be used a <strong>crosswalk</strong> (also called a concordance
          table) maps codes from one to the other so data can move between them.
        </p>
        <p>
          Crosswalk Generator builds a many-to-many crosswalk between two
          hierarchical classification systems entirely in your browser — nothing
          is uploaded anywhere, and everything auto-saves to this device as you go.
        </p>
        <ol>
          <li>Upload a CSV for System A and System B (or try a sample dataset).</li>
          <li>Browse each system as a tree; click codes on both sides to select them.</li>
          <li>
            Click <strong>Link</strong> to group the selected codes into one mapping, or
            flag a one-sided selection as <strong>no match</strong>.
          </li>
          <li>Export the result as a crosswalk (.zip of CSVs) or save the project to resume later.</li>
        </ol>
        <p>
          A code already mapped elsewhere on its side is locked from a second mapping;
          clicking a not-yet-mapped parent code selects every unmapped leaf beneath it.
        </p>
        <h3>Keyboard shortcuts</h3>
        <ul>
          <li><kbd>L</kbd> — create the mapping for the current selection (same as clicking Link)</li>
        </ul>
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
  .help-body h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin: 16px 0 6px;
  }
  .help-body ol,
  .help-body ul {
    margin: 0 0 12px;
    padding-left: 20px;
  }
  .help-body li {
    margin-bottom: 4px;
  }
  .help-body kbd {
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
</style>
