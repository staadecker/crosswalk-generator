<script>
  import FileUpload from './FileUpload.svelte';
  import ColumnMapper from './ColumnMapper.svelte';
  import TreePanel from './TreePanel.svelte';
  import { parseCsv, guessColumns } from '../lib/csv.js';
  import { makeSystem, mappings, clearMappingsForSide } from '../lib/stores.js';
  import { get } from 'svelte/store';

  let {
    system = $bindable(null), // bound system object (or null)
    selected = new Set(), // selection Set for this side
    counts = new Map(),
    noMatchCodes = new Set(),
    accent = 'A',
    title = 'System',
    samples = [], // [{ file, label }] — each offers a one-click "try sample data" shortcut
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

  // Sample datasets skip the column-mapping step entirely: columns are guessed
  // and the hierarchy is auto-built (level auto-detected from code structure)
  // in one click, so trying out the app never requires the user to understand
  // CSV column semantics up front. The bundled samples already have an
  // explicit row for every ancestor level, so they use "parent codes already
  // included" (autoParents: false) rather than auto-generate/synthesis —
  // turning synthesis on here would incorrectly treat every real sector/
  // division/group code as if it collided with itself and wrap it in a
  // spurious "<code> (group)" node.
  async function loadSample(sample) {
    error = '';
    loading = true;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${sample.file}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const text = await res.text();
      const { fields, rows } = await parseCsv(text);
      if (!fields.length || !rows.length) {
        error = 'That sample has no readable rows.';
        return;
      }
      const guess = guessColumns(fields, rows);
      const colMap = {
        level: null,
        code: guess.code,
        title: guess.title,
        description: guess.description,
        autoLevel: true,
        autoParents: false,
      };
      system = makeSystem(sample.label, rows, colMap);
      onClear?.();
    } catch (e) {
      error = `Could not load sample data: ${e.message ?? e}`;
    } finally {
      loading = false;
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
      {#if samples.length}
        <div class="samples">
          <span class="samples-label">Or try sample data:</span>
          <div class="sample-btns">
            {#each samples as sample (sample.file)}
              <button
                class="ghost small sample-btn"
                onclick={() => loadSample(sample)}
                disabled={loading}
              >
                {sample.label}
              </button>
            {/each}
          </div>
        </div>
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
  .samples {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .samples-label {
    font-size: 11px;
    color: var(--text-muted);
  }
  .sample-btns {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }
  .sample-btn {
    align-self: center;
  }
</style>
