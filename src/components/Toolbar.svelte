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
  } from '../lib/stores.js';
  import undoIcon from '@material-design-icons/svg/filled/undo.svg?raw';
  import redoIcon from '@material-design-icons/svg/filled/redo.svg?raw';
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
</script>

<div class="toolbar">
  <div class="brand">
    <span class="logo" aria-hidden="true">⇄</span>
    <div>
      <div class="name">Crosswalk Generator</div>
      <div class="sub">Create a mapping table between two hierarchical classification systems</div>
    </div>
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
</style>
