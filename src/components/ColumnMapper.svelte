<script>
  import { createEventDispatcher } from 'svelte';
  import { guessColumns } from '../lib/csv.js';

  export let fileName = '';
  export let fields = [];
  export let rows = [];

  const dispatch = createEventDispatcher();

  const guess = guessColumns(fields, rows);
  let levelCol = guess.level ?? '';
  let codeCol = guess.code ?? '';
  let descCol = guess.description ?? '';

  $: canContinue = levelCol && codeCol && descCol;
  $: preview = rows.slice(0, 5);

  function confirm() {
    if (!canContinue) return;
    dispatch('confirm', { colMap: { level: levelCol, code: codeCol, description: descCol } });
  }
</script>

<div class="mapper">
  <p class="intro">
    Confirm the columns in <strong>{fileName}</strong>. The <strong>level</strong> column
    (an integer per row indicating hierarchy depth) is required.
  </p>

  <div class="fields">
    <label>
      <span>Level column <em>(required)</em></span>
      <select bind:value={levelCol}>
        <option value="">— select —</option>
        {#each fields as f}<option value={f}>{f}</option>{/each}
      </select>
    </label>
    <label>
      <span>Code column</span>
      <select bind:value={codeCol}>
        <option value="">— select —</option>
        {#each fields as f}<option value={f}>{f}</option>{/each}
      </select>
    </label>
    <label>
      <span>Description column</span>
      <select bind:value={descCol}>
        <option value="">— select —</option>
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
              <th class:sel={f === levelCol || f === codeCol || f === descCol}>
                {f}
                {#if f === levelCol}<span class="tag">level</span>{/if}
                {#if f === codeCol}<span class="tag">code</span>{/if}
                {#if f === descCol}<span class="tag">desc</span>{/if}
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
    <button class="ghost" on:click={() => dispatch('cancel')}>Cancel</button>
    <button class="primary" disabled={!canContinue} on:click={confirm}>
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
