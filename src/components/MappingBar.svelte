<script>
  import { RELATIONS, DEFAULT_RELATION, addMapping, mappingExists } from '../lib/stores.js';

  export let systemA = null;
  export let systemB = null;
  export let selectionA = null;
  export let selectionB = null;
  export let mappings = [];

  let relation = DEFAULT_RELATION;
  let note = '';
  let flash = '';

  $: nodeA = selectionA && systemA ? systemA.tree.byCode.get(selectionA) : null;
  $: nodeB = selectionB && systemB ? systemB.tree.byCode.get(selectionB) : null;
  $: duplicate = nodeA && nodeB && mappingExists(mappings, selectionA, selectionB);
  $: canLink = nodeA && nodeB && !duplicate;

  function link() {
    if (!canLink) return;
    const ok = addMapping(selectionA, selectionB, relation, note.trim());
    if (ok) {
      flash = 'Linked ✓';
      note = '';
      setTimeout(() => (flash = ''), 1400);
    }
  }
</script>

<div class="bar">
  <div class="ends">
    <div class="end" data-accent="A">
      <span class="end-label">Source</span>
      {#if nodeA}
        <span class="code">{nodeA.code}</span>
        <span class="desc" title={nodeA.description}>{nodeA.description}</span>
      {:else}
        <span class="placeholder">Select a code on the left</span>
      {/if}
    </div>

    <div class="mid">
      <select bind:value={relation} aria-label="Relationship type">
        {#each RELATIONS as r}
          <option value={r.value}>{r.symbol}&nbsp; {r.label}</option>
        {/each}
      </select>
    </div>

    <div class="end" data-accent="B">
      <span class="end-label">Target</span>
      {#if nodeB}
        <span class="code">{nodeB.code}</span>
        <span class="desc" title={nodeB.description}>{nodeB.description}</span>
      {:else}
        <span class="placeholder">Select a code on the right</span>
      {/if}
    </div>
  </div>

  <div class="linkrow">
    <input
      type="text"
      placeholder="Optional note…"
      bind:value={note}
      on:keydown={(e) => e.key === 'Enter' && link()}
      aria-label="Mapping note"
    />
    <button class="primary" disabled={!canLink} on:click={link}>
      Link
    </button>
  </div>

  <div class="hint" aria-live="polite">
    {#if flash}<span class="ok">{flash}</span>
    {:else if duplicate}<span class="warn">These two codes are already linked.</span>
    {:else if !nodeA || !nodeB}Select one code on each side to link them.
    {/if}
  </div>
</div>

<style>
  .bar {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ends {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 10px;
    align-items: stretch;
  }
  .end {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    min-width: 0;
  }
  .end[data-accent='A'] {
    border-left: 3px solid var(--accent);
  }
  .end[data-accent='B'] {
    border-right: 3px solid var(--accent);
    text-align: right;
  }
  .end-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .code {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-weight: 700;
  }
  .desc {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .placeholder {
    color: var(--text-muted);
    font-style: italic;
    font-size: 12px;
  }
  .mid {
    display: flex;
    align-items: center;
  }
  .mid select {
    height: 100%;
  }
  .linkrow {
    display: flex;
    gap: 8px;
  }
  .linkrow input {
    flex: 1;
    min-width: 0;
  }
  .linkrow button {
    flex: none;
    min-width: 84px;
  }
  .hint {
    font-size: 12px;
    color: var(--text-muted);
    min-height: 16px;
    text-align: center;
  }
  .hint .ok {
    color: var(--accent);
    font-weight: 600;
  }
  .hint .warn {
    color: var(--danger);
  }
  @media (max-width: 640px) {
    .ends {
      grid-template-columns: 1fr;
    }
    .end[data-accent='B'] {
      text-align: left;
      border-right: none;
      border-left: 3px solid var(--accent);
    }
  }
</style>
