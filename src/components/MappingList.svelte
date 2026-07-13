<script>
  import { RELATIONS, relationMeta, updateMapping, removeMapping } from '../lib/stores.js';

  export let mappings = [];
  export let systemA = null;
  export let systemB = null;
  export let selectionA = null;
  export let selectionB = null;

  let filterToSelection = false;

  $: aByCode = systemA?.tree.byCode ?? new Map();
  $: bByCode = systemB?.tree.byCode ?? new Map();

  $: visible = mappings
    .map((m) => ({
      ...m,
      sourceDesc: aByCode.get(m.sourceCode)?.description ?? '',
      targetDesc: bByCode.get(m.targetCode)?.description ?? '',
    }))
    .filter((m) => {
      if (!filterToSelection) return true;
      return (
        (selectionA && m.sourceCode === selectionA) ||
        (selectionB && m.targetCode === selectionB)
      );
    });

  $: hasSelection = Boolean(selectionA || selectionB);
</script>

<div class="list">
  <header>
    <h3>Mappings <span class="count">{mappings.length}</span></h3>
    {#if hasSelection}
      <label class="filter">
        <input type="checkbox" bind:checked={filterToSelection} />
        Only selected
      </label>
    {/if}
  </header>

  <div class="rows">
    {#if mappings.length === 0}
      <p class="empty">No mappings yet. Select a code on each side and click <strong>Link</strong>.</p>
    {:else if visible.length === 0}
      <p class="empty">No mappings touch the current selection.</p>
    {:else}
      {#each visible as m (m.id)}
        {@const meta = relationMeta(m.relation)}
        <div class="row">
          <div class="pair">
            <div class="side">
              <span class="code">{m.sourceCode}</span>
              <span class="d" title={m.sourceDesc}>{m.sourceDesc}</span>
            </div>
            <span class="rel" title={meta.label}>{meta.symbol}</span>
            <div class="side">
              <span class="code">{m.targetCode}</span>
              <span class="d" title={m.targetDesc}>{m.targetDesc}</span>
            </div>
          </div>
          <div class="row-controls">
            <select
              aria-label="Relationship for {m.sourceCode} to {m.targetCode}"
              value={m.relation}
              on:change={(e) => updateMapping(m.id, { relation: e.target.value })}
            >
              {#each RELATIONS as r}<option value={r.value}>{r.symbol} {r.label}</option>{/each}
            </select>
            <button class="danger" title="Remove" on:click={() => removeMapping(m.id)}>✕</button>
          </div>
          {#if m.note}<div class="note">{m.note}</div>{/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    min-height: 0;
    overflow: hidden;
    flex: 1;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  h3 {
    margin: 0;
    font-size: 13px;
  }
  .count {
    display: inline-block;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 9px;
    font-size: 11px;
    padding: 0 6px;
    margin-left: 4px;
    color: var(--text-muted);
  }
  .filter {
    font-size: 12px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .rows {
    overflow: auto;
    flex: 1;
    min-height: 0;
  }
  .empty {
    color: var(--text-muted);
    padding: 16px;
    text-align: center;
    font-size: 13px;
  }
  .row {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    display: grid;
    gap: 6px;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 8px;
    align-items: center;
  }
  .side {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .code {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-weight: 600;
    font-size: 12px;
  }
  .d {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rel {
    color: var(--accent);
    font-weight: 700;
    text-align: center;
  }
  .row-controls {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .row-controls select {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    padding: 4px 6px;
  }
  .note {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
  }
</style>
