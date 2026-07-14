<script>
  import { get } from 'svelte/store';
  import {
    systemA,
    systemB,
    mappings,
    exportProject,
    loadProject,
    clearAll,
  } from '../lib/stores.js';
  import {
    buildCrosswalkRows,
    crosswalkToCsv,
    buildSourceToNameRows,
    sourceToNameCsv,
    buildNameToTargetRows,
    nameToTargetCsv,
    downloadFile,
    readFileText,
  } from '../lib/crosswalk.js';

  let { mappingCount = 0 } = $props();

  let importEl;
  let message = $state('');
  let exportMode = $state('single'); // 'single' (N×N in one file) | 'split' (many-to-one + one-to-many)

  function stamp() {
    return new Date().toISOString().slice(0, 10);
  }

  async function exportCsv() {
    const groups = get(mappings);
    if (!groups.length) {
      flash('Nothing to export yet.');
      return;
    }
    const a = get(systemA);
    const b = get(systemB);
    if (exportMode === 'single') {
      const rows = buildCrosswalkRows(groups, a, b);
      downloadFile(`crosswalk-${stamp()}.csv`, crosswalkToCsv(rows), 'text/csv');
    } else {
      const sourceRows = buildSourceToNameRows(groups, a);
      const targetRows = buildNameToTargetRows(groups, b);
      downloadFile(`crosswalk-source-to-name-${stamp()}.csv`, sourceToNameCsv(sourceRows), 'text/csv');
      // Two downloads triggered back-to-back in the same tick can be coalesced by the
      // browser into a single download event; a tick's gap keeps them distinct.
      await new Promise((resolve) => setTimeout(resolve, 50));
      downloadFile(`crosswalk-name-to-target-${stamp()}.csv`, nameToTargetCsv(targetRows), 'text/csv');
    }
  }

  function saveProject() {
    downloadFile(`crosswalk-project-${stamp()}.json`, exportProject(), 'application/json');
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
      <div class="sub">Map two hierarchical classifications — all in your browser</div>
    </div>
  </div>

  <div class="actions">
    {#if message}<span class="msg" aria-live="polite">{message}</span>{/if}
    <select
      bind:value={exportMode}
      aria-label="Export format"
      title="Single file: full N×N cross-product per mapping. Two files: source→name and name→target."
    >
      <option value="single">Export: one CSV (N×N)</option>
      <option value="split">Export: two CSVs (source→name, name→target)</option>
    </select>
    <button onclick={exportCsv} disabled={mappingCount === 0} title="Download the crosswalk as CSV">
      Export CSV
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
</style>
