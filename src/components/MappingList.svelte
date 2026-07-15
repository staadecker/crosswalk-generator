<script>
  import {
    updateGroupNote,
    removeMapping,
    removeCodesFromGroup,
    addCodesToGroup,
    moveCodesToGroup,
    isNoMatch,
    toggleApprox,
    hoverA,
    hoverB,
    focusCode,
  } from '../lib/stores.js';
  import { compactCodes, expandToLeaves } from '../lib/hierarchy.js';
  import { fastTooltip } from '../lib/tooltip.js';
  import noteIcon from '@material-design-icons/svg/filled/sticky_note_2.svg?raw';
  import { mappingList as strings, common } from '../lib/strings.js';

  let {
    mappings = [],
    systemA = null,
    systemB = null,
  } = $props();

  let labelA = $derived(systemA?.name || common.fallbackLabelA);
  let labelB = $derived(systemB?.name || common.fallbackLabelB);

  let dragOverKey = $state(null); // `${groupId}:${side}` currently being dragged over
  let flash = $state('');

  function say(msg) {
    flash = msg;
    setTimeout(() => (flash = ''), 2600);
  }

  // With hundreds of rows expected, the note field stays static text (not an
  // always-editable input) until explicitly opened for editing — keeps each
  // row to a single compact line in the common case.
  let editingNote = $state(new Set());

  function startEditNote(id) {
    editingNote = new Set(editingNote).add(id);
  }
  function stopEditNote(id, value) {
    if (value !== undefined) updateGroupNote(id, value.trim());
    const next = new Set(editingNote);
    next.delete(id);
    editingNote = next;
  }

  /** Focus (and select the text of) an input as soon as it mounts. */
  function autofocus(node) {
    node.focus();
    node.select?.();
  }


  let aByCode = $derived(systemA?.tree.byCode ?? new Map());
  let bByCode = $derived(systemB?.tree.byCode ?? new Map());

  // Compact a group's leaf codes down to display "bubbles": a bubble may stand in
  // for a whole parent's worth of leaves (see compactCodes) — removing it removes
  // every leaf it covers.
  function bubbles(system, byCode, leafCodes) {
    if (!leafCodes.length) return [];
    const displayCodes = system ? compactCodes(system.tree, new Set(leafCodes)) : [...leafCodes];
    return displayCodes.map((code) => {
      const node = byCode.get(code);
      return {
        code,
        tooltip: node?.title || '',
        leaves: system ? [...expandToLeaves(system.tree, [code])] : [code],
      };
    });
  }

  let rows = $derived(
    mappings.map((g) => ({
      ...g,
      noMatch: isNoMatch(g),
      aBubbles: bubbles(systemA, aByCode, g.aLeafCodes),
      bBubbles: bubbles(systemB, bByCode, g.bLeafCodes),
    })),
  );

  // The leaf descendants of whatever's currently hovered in each tree panel (or
  // null if nothing's hovered there) — the hovered code may be an ancestor (e.g.
  // one showing an aggregated mapping badge) rather than a leaf, so it's expanded
  // up front and reused both for row-level and bubble-level highlight checks.
  let hoverALeaves = $derived.by(() => ($hoverA && systemA ? expandToLeaves(systemA.tree, [$hoverA]) : null));
  let hoverBLeaves = $derived.by(() => ($hoverB && systemB ? expandToLeaves(systemB.tree, [$hoverB]) : null));

  // A group is highlighted while the code currently hovered in either tree panel
  // belongs to it (touches any of its leaf codes on that side).
  let highlightedIds = $derived.by(() => {
    const aLeaves = hoverALeaves;
    const bLeaves = hoverBLeaves;
    const ids = new Set();
    if (!aLeaves && !bLeaves) return ids;
    for (const g of mappings) {
      const touchesA = aLeaves && g.aLeafCodes.some((c) => aLeaves.has(c));
      const touchesB = bLeaves && g.bLeafCodes.some((c) => bLeaves.has(c));
      if (touchesA || touchesB) ids.add(g.id);
    }
    return ids;
  });

  // Within a highlighted group, the specific bubble the hovered code actually
  // falls under (not every bubble in the row) — a bubble may stand in for
  // several leaves (see bubbles()), so this checks for overlap the same way
  // group-level highlighting does, just scoped to one bubble's own leaf set.
  function bubbleHighlighted(bubble, hoverLeaves) {
    return !!hoverLeaves && bubble.leaves.some((l) => hoverLeaves.has(l));
  }

  // A hover-driven highlight is often off-screen in a list with hundreds of
  // rows, so scroll the first newly-highlighted row into view (not just
  // highlight it) — `block: 'nearest'` only moves the scroll position if the
  // row genuinely isn't visible, so hovering something already in view never
  // causes a jarring jump. Only fires when a hover actually starts a new
  // highlight (guarded by the `ids.size` check), never on hover-end.
  let rowsEl;
  $effect(() => {
    const ids = highlightedIds;
    if (!ids.size || !rowsEl) return;
    const firstId = [...ids][0];
    const el = rowsEl.querySelector(`[data-group-id="${CSS.escape(firstId)}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  function removeBubble(groupId, side, bubble) {
    removeCodesFromGroup(groupId, side, bubble.leaves);
  }

  function allowDrop(e, key) {
    e.preventDefault();
    dragOverKey = key;
  }

  function handleDrop(e, groupId, side) {
    e.preventDefault();
    dragOverKey = null;
    const code = e.dataTransfer.getData('text/plain');
    const originSide = e.dataTransfer.getData('application/x-crosswalk-side');
    const sourceGroupId = e.dataTransfer.getData('application/x-crosswalk-group-id');
    if (!code || originSide !== side) return;
    const system = side === 'A' ? systemA : systemB;
    const leaves = system ? [...expandToLeaves(system.tree, [code])] : [code];
    const { skipped } = sourceGroupId
      ? moveCodesToGroup(sourceGroupId, groupId, side, leaves)
      : addCodesToGroup(groupId, side, leaves);
    if (skipped.length) {
      say(strings.skippedMessage(skipped.length));
    }
  }
</script>

<div class="list">
  <header>
    <h3>{strings.groupingsTitle} <span class="count">{mappings.length}</span></h3>
    {#if flash}<span class="flash" aria-live="polite">{flash}</span>{/if}
  </header>

  <div class="rows" bind:this={rowsEl}>
    {#if mappings.length === 0}
      <p class="empty">{strings.emptyNoGroupingsPrefix} <strong>Group</strong> {strings.emptyNoGroupingsSuffix}</p>
    {:else}
      {#each rows as m (m.id)}
        <div class="row" data-group-id={m.id} class:nomatch={m.noMatch} class:highlighted={highlightedIds.has(m.id)}>
          <div class="row-head">
            <div class="pair">
              <div
                class="side"
                class:drag-over={dragOverKey === `${m.id}:A`}
                role="group"
                aria-label={strings.sideAriaLabel(labelA, m.name)}
                ondragover={(e) => allowDrop(e, `${m.id}:A`)}
                ondragleave={() => (dragOverKey = null)}
                ondrop={(e) => handleDrop(e, m.id, 'A')}
              >
                {#if m.aBubbles.length}
                  {#each m.aBubbles as b (b.code)}
                    <span
                      class="bubble"
                      class:bubble-highlighted={bubbleHighlighted(b, hoverALeaves)}
                      role="button"
                      tabindex="0"
                      draggable="true"
                      use:fastTooltip={() => b.tooltip}
                      onclick={() => focusCode('A', b.code)}
                      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && focusCode('A', b.code)}
                      ondragstart={(e) => {
                        e.dataTransfer.setData('text/plain', b.code);
                        e.dataTransfer.setData('application/x-crosswalk-side', 'A');
                        e.dataTransfer.setData('application/x-crosswalk-group-id', m.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                    >
                      <span class="bubble-code">{b.code}</span>
                      <button
                        class="bubble-x"
                        aria-label={strings.removeBubbleAriaLabel(b.code, m.name)}
                        onclick={(e) => {
                          e.stopPropagation();
                          removeBubble(m.id, 'A', b);
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  {/each}
                {:else}
                  <span class="none">{strings.noMatchDropHint(labelA)}</span>
                {/if}
              </div>
              <button
                class="rel"
                title={m.approx ? strings.relTitleApprox : strings.relTitleEqual}
                aria-label={strings.toggleRelAriaLabel(m.name)}
                onclick={() => toggleApprox(m.id)}
              >
                {m.approx ? '≈' : '='}
              </button>
              <div
                class="side"
                class:drag-over={dragOverKey === `${m.id}:B`}
                role="group"
                aria-label={strings.sideAriaLabel(labelB, m.name)}
                ondragover={(e) => allowDrop(e, `${m.id}:B`)}
                ondragleave={() => (dragOverKey = null)}
                ondrop={(e) => handleDrop(e, m.id, 'B')}
              >
                {#if m.bBubbles.length}
                  {#each m.bBubbles as b (b.code)}
                    <span
                      class="bubble"
                      class:bubble-highlighted={bubbleHighlighted(b, hoverBLeaves)}
                      role="button"
                      tabindex="0"
                      draggable="true"
                      use:fastTooltip={() => b.tooltip}
                      onclick={() => focusCode('B', b.code)}
                      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && focusCode('B', b.code)}
                      ondragstart={(e) => {
                        e.dataTransfer.setData('text/plain', b.code);
                        e.dataTransfer.setData('application/x-crosswalk-side', 'B');
                        e.dataTransfer.setData('application/x-crosswalk-group-id', m.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                    >
                      <span class="bubble-code">{b.code}</span>
                      <button
                        class="bubble-x"
                        aria-label={strings.removeBubbleAriaLabel(b.code, m.name)}
                        onclick={(e) => {
                          e.stopPropagation();
                          removeBubble(m.id, 'B', b);
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  {/each}
                {:else}
                  <span class="none">{strings.noMatchDropHint(labelB)}</span>
                {/if}
              </div>
            </div>
            <div class="row-actions">
              <button
                class="icon-btn note-btn"
                class:has-note={!!m.note}
                title={m.note || strings.addNoteTitle}
                aria-label={m.note ? strings.editNoteAriaLabel(m.name) : strings.addNoteAriaLabel(m.name)}
                onclick={() => startEditNote(m.id)}
              >
                {@html noteIcon}
              </button>
              <button class="remove-btn" title={strings.removeMappingTitle} aria-label={strings.removeMappingAriaLabel(m.name)} onclick={() => removeMapping(m.id)}>✕</button>
            </div>
          </div>
          {#if editingNote.has(m.id)}
            <input
              class="note-input"
              placeholder={strings.notePlaceholder}
              value={m.note}
              aria-label={strings.noteAriaLabel(m.name)}
              use:autofocus
              onblur={(e) => stopEditNote(m.id, e.target.value)}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.target.blur();
                else if (e.key === 'Escape') stopEditNote(m.id);
              }}
            />
          {/if}
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
  .flash {
    font-size: 11px;
    color: var(--accent);
    font-weight: 600;
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
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid transparent;
    display: grid;
    gap: 4px;
  }
  .row.highlighted {
    border-left-color: var(--accent);
    background: var(--accent-soft);
  }
  .row-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row-actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .remove-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    background: none;
    padding: 0;
    color: var(--text-muted);
    font-size: 12px;
    border-radius: var(--radius-sm);
    transition: background 0.12s ease, color 0.12s ease;
  }
  .remove-btn:hover {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    color: var(--danger);
  }
  .icon-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    padding: 4px;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    opacity: 0;
    transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
  }
  .icon-btn :global(svg) {
    width: 14px;
    height: 14px;
    fill: currentColor;
    display: block;
  }
  .row:hover .icon-btn,
  .icon-btn:focus-visible,
  .icon-btn.has-note {
    opacity: 1;
  }
  .icon-btn:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .note-btn.has-note {
    color: var(--accent);
  }
  .pair {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 8px;
    align-items: start;
  }
  .side {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
    min-height: 26px;
    border: 1px dashed transparent;
    border-radius: var(--radius-sm);
    padding: 2px;
  }
  .side.drag-over {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .bubble {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1px 4px 1px 8px;
    font-size: 12px;
    cursor: grab;
  }
  .bubble:active {
    cursor: grabbing;
  }
  .bubble.bubble-highlighted {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .bubble-code {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-weight: 600;
  }
  .bubble-x {
    border: none;
    background: none;
    padding: 0 2px;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1;
  }
  .bubble-x:hover {
    color: var(--danger);
    background: none;
  }
  .rel {
    color: var(--accent);
    font-weight: 700;
    text-align: center;
    border: none;
    background: none;
    padding: 2px 4px;
    font-size: 15px;
    line-height: 1;
    border-radius: var(--radius-sm);
  }
  .rel:hover {
    background: var(--accent-soft);
  }
  .none {
    color: var(--text-muted);
    font-style: italic;
    font-size: 11px;
  }
  .row.nomatch {
    background: color-mix(in srgb, var(--text-muted) 6%, transparent);
  }
  .row.nomatch.highlighted {
    background: var(--accent-soft);
  }
  .note-input {
    font-size: 12px;
    font-style: italic;
    padding: 3px 6px;
    color: var(--text-muted);
    background: transparent;
    border-color: transparent;
  }
  .note-input:hover,
  .note-input:focus {
    background: var(--surface);
    border-color: var(--border);
  }
</style>
