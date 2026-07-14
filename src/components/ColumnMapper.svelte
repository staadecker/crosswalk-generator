<script>
  import { guessColumns } from '../lib/csv.js';

  let { fileName = '', fields = [], rows = [], onConfirm, onCancel } = $props();

  // Intentionally a one-time snapshot at mount (matches Svelte 4 behavior): this
  // component is destroyed/recreated whenever a new file is uploaded, so `fields`
  // and `rows` never change during its lifetime.
  // svelte-ignore state_referenced_locally
  const guess = guessColumns(fields, rows);
  let levelMode = $state('auto'); // 'column' | 'auto' — auto-detect is the default
  let levelCol = $state(guess.level ?? '');
  let codeCol = $state(guess.code ?? '');
  let titleCol = $state(guess.title ?? '');
  let descCol = $state(guess.description ?? ''); // optional long-form description
  let autoParents = $state(true); // auto mode only: synthesize missing ancestor codes

  let canContinue = $derived(codeCol && titleCol && (levelMode === 'auto' || levelCol));
  let preview = $derived(rows.slice(0, 5));

  function confirm() {
    if (!canContinue) return;
    const colMap = { code: codeCol, title: titleCol, description: descCol || null };
    if (levelMode === 'auto') {
      colMap.level = null;
      colMap.autoLevel = true;
      colMap.autoParents = autoParents;
    } else {
      colMap.level = levelCol;
    }
    onConfirm?.(colMap);
  }
</script>

<div class="mapper">
  <p class="intro">
    Confirm the columns in <strong>{fileName}</strong>. By default the hierarchy depth is
    auto-detected from each code's own structure; switch to specifying an explicit
    <strong>level</strong> column (an integer per row) if auto-detect gets it wrong.
  </p>

  <div class="level-mode">
    <label class="radio">
      <input type="radio" name="levelMode" value="column" bind:group={levelMode} />
      Specify level column
    </label>
    <label class="radio">
      <input type="radio" name="levelMode" value="auto" bind:group={levelMode} />
      Auto-detect level from code
    </label>
  </div>

  <div class="fields">
    {#if levelMode === 'column'}
      <label>
        <span>Level column <em>(required)</em></span>
        <select bind:value={levelCol}>
          <option value="">— select —</option>
          {#each fields as f}<option value={f}>{f}</option>{/each}
        </select>
      </label>
    {:else}
      <label class="checkbox">
        <input type="checkbox" bind:checked={autoParents} />
        Automatically create missing parent codes (e.g. synthesize "01" if only "01.a"/"01.b" exist)
      </label>
    {/if}
    <label>
      <span>Code column</span>
      <select bind:value={codeCol}>
        <option value="">— select —</option>
        {#each fields as f}<option value={f}>{f}</option>{/each}
      </select>
    </label>
    <label>
      <span>Title column</span>
      <select bind:value={titleCol}>
        <option value="">— select —</option>
        {#each fields as f}<option value={f}>{f}</option>{/each}
      </select>
    </label>
    <label>
      <span>Description column <em>(optional)</em></span>
      <select bind:value={descCol}>
        <option value="">— none —</option>
        {#each fields as f}<option value={f}>{f}</option>{/each}
      </select>
    </label>
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
  .level-mode {
    display: flex;
    gap: 16px;
    margin-bottom: 10px;
    font-size: 12px;
  }
  .level-mode .radio {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }
  .fields {
    display: grid;
    gap: 10px;
    margin-bottom: 12px;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }
  label.checkbox {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  label em {
    color: var(--accent);
    font-style: normal;
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
