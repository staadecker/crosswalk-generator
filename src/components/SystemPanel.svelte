<script>
  import FileUpload from './FileUpload.svelte';
  import ColumnMapper from './ColumnMapper.svelte';
  import TreePanel from './TreePanel.svelte';
  import { parseCsv } from '../lib/csv.js';
  import { makeSystem, mappings, clearMappingsForSide } from '../lib/stores.js';
  import { get } from 'svelte/store';

  let {
    system = $bindable(null), // bound system object (or null)
    selected = new Set(), // selection Set for this side
    counts = new Map(),
    noMatchCodes = new Set(),
    accent = 'A',
    title = 'System',
    onToggle,
    onClear,
    onHover,
    onSelectUnmapped,
    focusRequest = null, // { code, ts } | null — passed through to TreePanel
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

  // Replacing this side's file makes any mapping that touches it meaningless
  // (its codes belong to a tree that no longer exists), so replacing the file
  // deletes those mappings outright rather than leaving orphaned half-mappings
  // behind. Confirm first since this can't be undone.
  function changeFile() {
    const key = accent === 'A' ? 'aLeafCodes' : 'bLeafCodes';
    const affected = get(mappings).filter((g) => g[key].length > 0).length;
    if (affected > 0) {
      const ok = confirm(
        `Replacing this file will delete ${affected} mapping${affected === 1 ? '' : 's'} that reference it. This cannot be undone. Continue?`,
      );
      if (!ok) return;
    }
    clearMappingsForSide(accent);
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
    {focusRequest}
    onChange={changeFile}
    onRename={(name) => (system = { ...system, name })}
  />
{:else}
  <div class="setup" data-accent={accent}>
    <div class="setup-head">{title}</div>
    {#if phase === 'idle'}
      <FileUpload
        label={`Upload ${title} CSV`}
        hint="Must include code and title columns. Level and description are optional."
        {onFile}
      />
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
</style>
