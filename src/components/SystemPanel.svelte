<script>
  import FileUpload from './FileUpload.svelte';
  import ColumnMapper from './ColumnMapper.svelte';
  import TreePanel from './TreePanel.svelte';
  import { parseCsv } from '../lib/csv.js';
  import { makeSystem } from '../lib/stores.js';

  export let system = null;        // bound system object (or null)
  export let selectedCode = null;  // bound selection
  export let counts = new Map();
  export let accent = 'A';
  export let title = 'System';

  // Local flow state: 'idle' -> 'mapping' once a file is parsed.
  let phase = 'idle';
  let parsed = null; // { fileName, fields, rows }
  let error = '';
  let loading = false;

  async function onFile(file) {
    error = '';
    loading = true;
    try {
      const { fields, rows } = await parseCsv(file);
      if (!fields.length || !rows.length) {
        error = 'That file has no readable rows.';
      } else {
        parsed = { fileName: file.name, fields, rows };
        phase = 'mapping';
      }
    } catch (e) {
      error = `Could not parse CSV: ${e.message ?? e}`;
    } finally {
      loading = false;
    }
  }

  function onConfirm(colMap) {
    system = makeSystem(parsed.fileName.replace(/\.csv$/i, ''), parsed.rows, colMap);
    selectedCode = null;
    phase = 'idle';
    parsed = null;
  }

  function cancelMapping() {
    phase = 'idle';
    parsed = null;
  }

  function changeFile() {
    system = null;
    selectedCode = null;
    phase = 'idle';
    parsed = null;
  }
</script>

{#if system}
  <TreePanel
    {system}
    {selectedCode}
    {counts}
    {accent}
    on:select={(e) => (selectedCode = e.detail)}
    on:change={changeFile}
  />
{:else}
  <div class="setup" data-accent={accent}>
    <div class="setup-head">{title}</div>
    {#if phase === 'idle'}
      <FileUpload
        label={`Upload ${title} CSV`}
        hint="Must include level, code, and description columns."
        on:file={(e) => onFile(e.detail)}
      />
      {#if loading}<p class="status">Parsing…</p>{/if}
      {#if error}<p class="status error">{error}</p>{/if}
    {:else if phase === 'mapping'}
      <ColumnMapper
        fileName={parsed.fileName}
        fields={parsed.fields}
        rows={parsed.rows}
        on:confirm={(e) => onConfirm(e.detail.colMap)}
        on:cancel={cancelMapping}
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
</style>
