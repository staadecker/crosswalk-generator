<script>
  import { addGroup, markNoMatch, uniqueMappingOnly, defaultGroupName } from '../lib/stores.js';
  import { expandToLeaves } from '../lib/hierarchy.js';

  let {
    systemA = null,
    systemB = null,
    selectionA = new Set(), // codes selected on system A
    selectionB = new Set(), // codes selected on system B
    onLinked,
    onClearA,
    onClearB,
    onRemoveA,
    onRemoveB,
  } = $props();

  let note = $state('');
  let flash = $state('');

  let labelA = $derived(systemA?.name || 'A');
  let labelB = $derived(systemB?.name || 'B');

  // Resolve selected codes to {code, title, tooltip} chips.
  function chips(sel, system) {
    const byCode = system?.tree.byCode ?? new Map();
    return [...sel].map((code) => {
      const node = byCode.get(code);
      return { code, tooltip: node?.description || node?.title || '' };
    });
  }
  let aChips = $derived(chips(selectionA, systemA));
  let bChips = $derived(chips(selectionB, systemB));

  let nA = $derived(selectionA.size);
  let nB = $derived(selectionB.size);
  let canLink = $derived(nA > 0 && nB > 0);
  // No-match applies when exactly one side has a selection.
  let noMatchSide = $derived(nA > 0 && nB === 0 ? 'A' : nB > 0 && nA === 0 ? 'B' : null);

  function say(msg) {
    flash = msg;
    setTimeout(() => (flash = ''), 2600);
  }

  function link() {
    if (!canLink) return;
    const aLeaves = expandToLeaves(systemA.tree, selectionA);
    const bLeaves = expandToLeaves(systemB.tree, selectionB);
    const name = defaultGroupName(systemA, aLeaves);
    const { skippedA, skippedB } = addGroup([...aLeaves], [...bLeaves], name, note.trim());
    note = '';
    onLinked?.(); // App clears both selections
    const keptA = aLeaves.size - skippedA.length;
    const keptB = bLeaves.size - skippedB.length;
    const skippedTotal = skippedA.length + skippedB.length;
    say(
      `Created a mapping linking ${keptA} × ${keptB} code(s).` +
        (skippedTotal ? ` (${skippedTotal} skipped — already mapped elsewhere)` : ''),
    );
  }

  function noMatch() {
    if (!noMatchSide) return;
    const system = noMatchSide === 'A' ? systemA : systemB;
    const sel = noMatchSide === 'A' ? selectionA : selectionB;
    const leaves = expandToLeaves(system.tree, sel);
    const name = defaultGroupName(system, leaves);
    const { added, skipped } = markNoMatch(noMatchSide, [...leaves], name, note.trim());
    note = '';
    onLinked?.();
    say(`Marked ${added} code${added === 1 ? '' : 's'} as no match${skipped ? ` (${skipped} skipped — already mapped)` : ''}.`);
  }
</script>

<div class="bar">
  <div class="ends">
    <div class="end" data-accent="A">
      <div class="end-head">
        <span class="end-label">{labelA}</span>
        {#if nA}<button class="linky" onclick={() => onClearA?.()}>clear</button>{/if}
      </div>
      {#if aChips.length}
        <div class="chips">
          {#each aChips as c (c.code)}
            <span class="chip" title={c.tooltip}>
              <span class="chip-code">{c.code}</span>
              <button class="chip-x" aria-label="Remove {c.code}" onclick={() => onRemoveA?.(c.code)}>✕</button>
            </span>
          {/each}
        </div>
      {:else}
        <span class="placeholder">Click codes on the left</span>
      {/if}
    </div>

    <div class="mid" aria-hidden="true">→</div>

    <div class="end" data-accent="B">
      <div class="end-head">
        <span class="end-label">{labelB}</span>
        {#if nB}<button class="linky" onclick={() => onClearB?.()}>clear</button>{/if}
      </div>
      {#if bChips.length}
        <div class="chips">
          {#each bChips as c (c.code)}
            <span class="chip" title={c.tooltip}>
              <span class="chip-code">{c.code}</span>
              <button class="chip-x" aria-label="Remove {c.code}" onclick={() => onRemoveB?.(c.code)}>✕</button>
            </span>
          {/each}
        </div>
      {:else}
        <span class="placeholder">Click codes on the right</span>
      {/if}
    </div>
  </div>

  <div class="linkrow">
    <input
      type="text"
      placeholder="Optional note (applied to this mapping)…"
      bind:value={note}
      onkeydown={(e) => e.key === 'Enter' && link()}
      aria-label="Mapping note"
      disabled={!canLink}
    />
    {#if noMatchSide}
      <button class="nomatch-btn" onclick={noMatch}>
        Mark {noMatchSide === 'A' ? nA : nB} as no match
      </button>
    {:else}
      <button class="primary" disabled={!canLink} onclick={link}>
        Link
      </button>
    {/if}
  </div>

  <div class="hint" aria-live="polite">
    {#if flash}<span class="ok">{flash}</span>
    {:else if canLink}Creates one mapping grouping {nA} {labelA} code{nA === 1 ? '' : 's'} with {nB} {labelB} code{nB === 1 ? '' : 's'}.
    {:else if noMatchSide}These {noMatchSide === 'A' ? nA : nB} code(s) have no counterpart? Mark them no match.
    {:else}Click one or more codes on each side to link them.
    {/if}
  </div>

  <label class="unique-toggle" title="When on, a code can only belong to one mapping at a time per side">
    <input type="checkbox" bind:checked={$uniqueMappingOnly} />
    Only allow each code to be mapped once
  </label>
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
    gap: 6px;
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
  }
  .end-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .end-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-height: 92px;
    overflow-y: auto;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1px 4px 1px 8px;
    font-size: 12px;
  }
  .chip-code {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-weight: 600;
  }
  .chip-x {
    border: none;
    background: none;
    padding: 0 2px;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1;
  }
  .chip-x:hover {
    color: var(--danger);
    background: none;
  }
  .placeholder {
    color: var(--text-muted);
    font-style: italic;
    font-size: 12px;
  }
  .linky {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    font-size: 11px;
    text-decoration: underline;
  }
  .mid {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 16px;
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
    min-width: 110px;
  }
  .nomatch-btn {
    border-color: var(--border);
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
  .unique-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
  }
  @media (max-width: 640px) {
    .ends {
      grid-template-columns: 1fr;
    }
    .end[data-accent='B'] {
      border-right: none;
      border-left: 3px solid var(--accent);
    }
  }
</style>
