<script>
  import FileUpload from './FileUpload.svelte';
  import ColumnMapper from './ColumnMapper.svelte';
  import TreePanel from './TreePanel.svelte';
  import { parseCsv } from '../lib/csv.js';
  import { makeSystem } from '../lib/stores.js';

  let {
    system = $bindable(null), // bound system object (or null)
    selected = new Set(), // selection Set for this side
    counts = new Map(),
    noMatchCodes = new Set(),
    accent = 'A',
    title = 'System',
    sampleFile = null, // e.g. 'naics-sample.csv' — offers a "try sample data" shortcut
    onToggle,
    onClear,
    onHover,
    onSelectUnmapped,
  } = $props();

  // Local flow state: 'idle' -> 'mapping' once a file is parsed.
  let phase = $state('idle');
  let parsed = $state(null); // { fileName, fields, rows }
  let error = $state('');
  let loading = $state(false);

  async function parseAndStage(fileName, input) {
    error = '';
    loading = true;
    try {
      const { fields, rows } = await parseCsv(input);
      if (!fields.length || !rows.length) {
        error = 'That file has no readable rows.';
      } else {
        parsed = { fileName, fields, rows };
        phase = 'mapping';
      }
    } catch (e) {
      error = `Could not parse CSV: ${e.message ?? e}`;
    } finally {
      loading = false;
    }
  }

  function onFile(file) {
    return parseAndStage(file.name, file);
  }

  async function loadSample() {
    error = '';
    loading = true;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${sampleFile}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      await parseAndStage(sampleFile, text);
    } catch (e) {
      loading = false;
      error = `Could not load sample data: ${e.message ?? e}`;
    }
  }

  function onConfirm(colMap) {
    system = makeSystem(parsed.fileName.replace(/\.csv$/i, ''), parsed.rows, colMap);
    onClear?.();
    phase = 'idle';
    parsed = null;
  }

  function cancelMapping() {
    phase = 'idle';
    parsed = null;
  }

  function changeFile() {
    system = null;
    onClear?.();
    phase = 'idle';
    parsed = null;
  }
</script>

{#if system}
  <TreePanel
    {system}
    {selected}
    {counts}
    {noMatchCodes}
    {accent}
    {onToggle}
    {onClear}
    {onHover}
    {onSelectUnmapped}
    onChange={changeFile}
  />
{:else}
  <div class="setup" data-accent={accent}>
    <div class="setup-head">{title}</div>
    {#if phase === 'idle'}
      <FileUpload
        label={`Upload ${title} CSV`}
        hint="Must include level, code, and title columns. A description column is optional."
        {onFile}
      />
      {#if sampleFile}
        <button class="ghost small sample-btn" onclick={loadSample} disabled={loading}>
          Try with sample data
        </button>
      {/if}
      {#if loading}<p class="status">Parsing…</p>{/if}
      {#if error}<p class="status error">{error}</p>{/if}
    {:else if phase === 'mapping'}
      <ColumnMapper
        fileName={parsed.fileName}
        fields={parsed.fields}
        rows={parsed.rows}
        {onConfirm}
        onCancel={cancelMapping}
      />
    {/if}
  </div>
{/if}

<style>
  .setup {
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 16px;
    overflow: auto;
  }
  .setup-head {
    font-weight: 700;
    font-size: 14px;
  }
  .status {
    margin: 0;
    font-size: 13px;
    color: var(--text-muted);
  }
  .status.error {
    color: var(--danger);
  }
  .sample-btn {
    align-self: center;
  }
</style>
