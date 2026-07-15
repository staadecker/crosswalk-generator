<script>
  import { guessColumns } from '../lib/csv.js';
  import { fastTooltip } from '../lib/tooltip.js';

  let { fileName = '', fields = [], rows = [], onConfirm, onCancel } = $props();

  // Intentionally a one-time snapshot at mount (matches Svelte 4 behavior): this
  // component is destroyed/recreated whenever a new file is uploaded, so `fields`
  // and `rows` never change during its lifetime.
  // svelte-ignore state_referenced_locally
  const guess = guessColumns(fields, rows);
  // The level dropdown always starts on "Auto-detect" (empty string), even if a
  // level-shaped column was guessed — auto-detect is the recommended default and
  // shouldn't be silently overridden by a guess the user hasn't confirmed.
  let levelCol = $state(''); // '' = auto-detect from code structure; otherwise an explicit column name
  let codeCol = $state(guess.code ?? '');
  let titleCol = $state(guess.title ?? '');
  let descCol = $state(guess.description ?? ''); // optional long-form description
  // Whether the file already has an explicit row for every ancestor level
  // (checked), or missing ancestor codes should be synthesized (unchecked,
  // the default).
  let dataIncludesParents = $state(false);

  // An explicit level column only makes sense when every ancestor level is
  // already present as its own row — the auto-generate-parents path is the
  // only one that knows how to synthesize a missing ancestor, and it only
  // applies to auto-detected levels. So picking a level column is disabled
  // (and reset back to auto-detect) whenever "data includes parent codes" is
  // unchecked, rather than letting the user pick a column that can't
  // actually be honored.
  $effect(() => {
    if (!dataIncludesParents) levelCol = '';
  });

  let canContinue = $derived(!!codeCol && !!titleCol);
  let preview = $derived(rows.slice(0, 5));

  function confirm() {
    if (!canContinue) return;
    const colMap = { code: codeCol, title: titleCol, description: descCol || null };
    if (levelCol) {
      colMap.level = levelCol;
    } else {
      colMap.level = null;
      colMap.autoLevel = true;
      colMap.autoParents = !dataIncludesParents;
    }
    onConfirm?.(colMap);
  }
</script>

<div class="mapper">
  <p class="intro">
    Confirm the columns in <strong>{fileName}</strong>.
  </p>

  <div class="section">
    <h3 class="section-title">Select columns</h3>
    <div class="fields">
      <label>
        <span>
          Code column
          <span
            class="help"
            tabindex="0"
            use:fastTooltip={'The unique identifier for each row, e.g. a NAICS or NACE code. Should be short and unique across the whole file.'}
            >?</span
          >
        </span>
        <select bind:value={codeCol}>
          <option value="">— select —</option>
          {#each fields as f}<option value={f}>{f}</option>{/each}
        </select>
      </label>
      <label>
        <span>
          Title column
          <span
            class="help"
            tabindex="0"
            use:fastTooltip={'A short label or name for each code — the primary text shown in the tree.'}
            >?</span
          >
        </span>
        <select bind:value={titleCol}>
          <option value="">— select —</option>
          {#each fields as f}<option value={f}>{f}</option>{/each}
        </select>
      </label>
      <label>
        <span>
          Description column <em>(optional)</em>
          <span
            class="help"
            tabindex="0"
            use:fastTooltip={'A longer, free-text description of each code. Shown only as a hover tooltip, never as the primary label.'}
            >?</span
          >
        </span>
        <select bind:value={descCol}>
          <option value="">— none —</option>
          {#each fields as f}<option value={f}>{f}</option>{/each}
        </select>
      </label>
    </div>
  </div>

  <div class="section">
    <h3 class="section-title">Configure nesting</h3>
    <div class="fields">
      <div class="question">
        <label class="checkbox">
          <input type="checkbox" bind:checked={dataIncludesParents} />
          <span>
            Data includes parent codes
            <span
              class="help"
              tabindex="0"
              use:fastTooltip={'Check this if your file already has an explicit row for every ancestor level (e.g. a row for "01" as well as "01.1" and "01.11"). Leave unchecked if it only lists the most specific codes.'}
              >?</span
            >
          </span>
        </label>
        <p class="hint">
          Parent codes are the ancestor rows above each code (e.g. "01" above "01.1"). Check
          this if your file already includes them — each code will nest under its own matching
          row. Leave unchecked (the default) to have missing ancestor codes generated
          automatically from each code's own structure (e.g. a "01" row will be created if only
          "01.a" and "01.b" are present).
        </p>
      </div>
      <label class="level-field" class:disabled={!dataIncludesParents}>
        <span>
          Level column
          <span
            class="help"
            tabindex="0"
            use:fastTooltip={`Optional. If your file has a column giving each row's hierarchy depth as an integer (not necessarily starting at 1 or sequential), pick it here. Leave on "Auto-detect" to infer depth from the shape of each code instead (e.g. "01" → "01.1" → "01.11", or a NAICS-style "48-49" sector range). Only available when "Data includes parent codes" is checked, since an explicit level column needs every ancestor row to already be present.`}
            >?</span
          >
        </span>
        <select bind:value={levelCol} disabled={!dataIncludesParents}>
          <option value="">Auto-detect from code structure</option>
          {#each fields as f}<option value={f}>{f}</option>{/each}
        </select>
      </label>
    </div>
  </div>

  {#if fields.length}
    <div class="preview-wrap">
      <table>
        <thead>
          <tr>
            {#each fields as f}
              <th class:sel={f === levelCol || f === codeCol || f === titleCol || f === descCol}>
                {f}
                {#if f === levelCol}<span class="tag">level</span>{/if}
                {#if f === codeCol}<span class="tag">code</span>{/if}
                {#if f === titleCol}<span class="tag">title</span>{/if}
                {#if f === descCol}<span class="tag">description</span>{/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each preview as row}
            <tr>
              {#each fields as f}<td>{row[f]}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <div class="actions">
    <button class="ghost" onclick={() => onCancel?.()}>Cancel</button>
    <button class="primary" disabled={!canContinue} onclick={confirm}>
      Build hierarchy
    </button>
  </div>
</div>

<style>
  .mapper {
    padding: 4px 2px;
  }
  .intro {
    margin: 0 0 12px;
    color: var(--text-muted);
  }
  .section {
    margin-bottom: 14px;
  }
  .section-title {
    margin: 0 0 8px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .question {
    display: grid;
    gap: 6px;
  }
  .checkbox {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
  }
  .hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-muted);
  }
  .fields {
    display: grid;
    gap: 10px;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }
  label span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  label em {
    color: var(--accent);
    font-style: normal;
  }
  .level-field.disabled {
    opacity: 0.55;
  }
  .level-field.disabled select {
    cursor: not-allowed;
  }
  .help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text-muted);
    border: 1px solid var(--border);
    font-size: 10px;
    font-weight: 700;
    cursor: help;
    flex: none;
  }
  .help:hover,
  .help:focus-visible {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent);
    outline: none;
  }
  select {
    width: 100%;
  }
  .preview-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    margin-bottom: 12px;
  }
  table {
    border-collapse: collapse;
    font-size: 12px;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  th {
    background: var(--surface-2);
    position: sticky;
    top: 0;
  }
  th.sel {
    color: var(--accent);
  }
  .tag {
    display: inline-block;
    font-size: 10px;
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: 4px;
    padding: 0 4px;
    margin-left: 4px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
