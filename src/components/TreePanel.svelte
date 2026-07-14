<script>
  import { flattenTree, expandToLeaves, leafCodesOf, compactCodes } from '../lib/hierarchy.js';
  import editIcon from '@material-design-icons/svg/filled/edit.svg?raw';

  let {
    system, // { name, tree, colMap, rows }
    selected = new Set(), // Set of selected codes on this side
    counts = new Map(), // code -> mapping count for this side
    noMatchCodes = new Set(), // codes flagged no-match on this side
    uniqueMappingOnly = false, // when true, an already-mapped code can't be selected for a new mapping
    accent = 'A', // 'A' | 'B' for subtle color differentiation
    onToggle,
    onClear,
    onChange,
    onRename, // called with a new dataset name (used in export filenames)
    onHover, // called with the hovered code, or null on leave — drives Mappings-pane highlight
    onSelectUnmapped, // called with an array of not-yet-mapped leaf codes under a node
  } = $props();

  let query = $state('');
  let expanded = $state(new Set());
  let allExpanded = $state(false);
  let editingName = $state(false);

  function stopEditName(value) {
    if (value !== undefined) onRename?.(value.trim() || system.name);
    editingName = false;
  }

  /** Focus (and select the text of) an input as soon as it mounts. */
  function autofocus(node) {
    node.focus();
    node.select?.();
  }

  // Default: expand roots so the tree isn't a wall of top-level codes only.
  $effect(() => {
    if (system && expanded.size === 0 && !allExpanded) {
      expanded = new Set(system.tree.roots.map((r) => r.code));
    }
  });

  let normalizedQuery = $derived(query.trim().toLowerCase());
  let matcher = $derived(
    normalizedQuery
      ? (node) =>
          node.code.toLowerCase().includes(normalizedQuery) ||
          node.title.toLowerCase().includes(normalizedQuery)
      : null,
  );

  let rows = $derived(system ? flattenTree(system.tree, expanded, matcher) : []);
  let warnings = $derived(system?.tree.warnings ?? []);

  // Mapping progress, counted over leaf codes only (parents aggregate counts but
  // aren't themselves exported, so they'd double-count progress).
  let leafTotal = $derived(system ? leafCodesOf(system.tree).length : 0);
  let leafMapped = $derived(
    system
      ? leafCodesOf(system.tree).filter((c) => (counts.get(c) ?? 0) > 0 || noMatchCodes.has(c)).length
      : 0,
  );
  let progressPct = $derived(leafTotal ? Math.round((leafMapped / leafTotal) * 100) : 0);

  function toggle(code) {
    const next = new Set(expanded);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    expanded = next;
  }

  function expandAll() {
    if (!system) return;
    expanded = new Set(system.tree.nodes.filter((n) => (system.tree.childrenOf.get(n.code) ?? []).length).map((n) => n.code));
    allExpanded = true;
  }

  function collapseAll() {
    expanded = new Set();
    allExpanded = false;
  }

  function select(code, locked) {
    if (locked) return; // already mapped elsewhere and uniqueMappingOnly is on — refuse the click outright
    onToggle?.(code); // click toggles membership in the selection set
  }

  // Selects every not-yet-mapped leaf descendant of `code` (leaves the rest of
  // the current selection untouched). The resulting selection is compacted back
  // up to the highest ancestor(s) whose full leaf set is being selected (same
  // rule as a mapping group's display bubbles), and every ancestor of those
  // codes is auto-expanded — otherwise a collapsed subtree would hide the newly
  // selected leaves entirely, making the button look like it did nothing.
  function selectUnmapped(code) {
    if (!system) return;
    const leaves = [...expandToLeaves(system.tree, [code])].filter(
      (c) => (counts.get(c) ?? 0) === 0 && !noMatchCodes.has(c),
    );
    if (!leaves.length) return;
    const compact = compactCodes(system.tree, new Set(leaves));
    const nextExpanded = new Set(expanded);
    for (const c of compact) {
      let parent = system.tree.byCode.get(c)?.parent;
      while (parent) {
        nextExpanded.add(parent);
        parent = system.tree.byCode.get(parent)?.parent;
      }
    }
    expanded = nextExpanded;
    onSelectUnmapped?.(compact);
  }

  function highlight(text) {
    if (!normalizedQuery) return [{ t: text, hit: false }];
    const lower = text.toLowerCase();
    const parts = [];
    let i = 0;
    while (i < text.length) {
      const idx = lower.indexOf(normalizedQuery, i);
      if (idx === -1) {
        parts.push({ t: text.slice(i), hit: false });
        break;
      }
      if (idx > i) parts.push({ t: text.slice(i, idx), hit: false });
      parts.push({ t: text.slice(idx, idx + normalizedQuery.length), hit: true });
      i = idx + normalizedQuery.length;
    }
    return parts;
  }
</script>

<div class="panel" data-accent={accent}>
  <header>
    <div class="titlerow">
      {#if editingName}
        <input
          class="name-input"
          value={system.name}
          title="Dataset name — also used in exported filenames"
          aria-label="Dataset name"
          use:autofocus
          onblur={(e) => stopEditName(e.target.value)}
          onkeydown={(e) => {
            if (e.key === 'Enter') e.target.blur();
            else if (e.key === 'Escape') stopEditName();
          }}
        />
      {:else}
        <span class="name-label" title="Dataset name — also used in exported filenames">{system.name}</span>
        <button
          class="icon-btn"
          title="Rename dataset"
          aria-label="Rename {system.name}"
          onclick={() => (editingName = true)}
        >
          {@html editIcon}
        </button>
      {/if}
      <button
        class="danger small"
        onclick={() => onChange?.()}
        title="Replace this file — deletes any mappings that reference it"
      >
        Replace file…
      </button>
    </div>
    <div class="controls">
      <input
        type="search"
        placeholder="Search code or title…"
        bind:value={query}
        aria-label="Search {system.name}"
      />
      <button class="ghost small" onclick={expandAll} title="Expand all">Expand</button>
      <button class="ghost small" onclick={collapseAll} title="Collapse all">Collapse</button>
    </div>
    <div class="meta">
      <span>{system.tree.nodes.length} codes</span>
      {#if selected.size > 0}
        <span class="selcount">
          {selected.size} selected
          <button class="linky" onclick={() => onClear?.()}>Clear</button>
        </span>
      {/if}
    </div>
    <div
      class="progress"
      role="progressbar"
      aria-label="{system.name} mapping progress"
      aria-valuenow={leafMapped}
      aria-valuemin="0"
      aria-valuemax={leafTotal}
    >
      <div class="progress-track">
        <div class="progress-fill" style="width: {progressPct}%"></div>
      </div>
      <span class="progress-label">{leafMapped} / {leafTotal} mapped</span>
    </div>
  </header>

  {#if warnings.length}
    <details class="warnings">
      <summary>{warnings.length} warning{warnings.length > 1 ? 's' : ''} while building hierarchy</summary>
      <ul>
        {#each warnings.slice(0, 50) as w}<li>{w}</li>{/each}
        {#if warnings.length > 50}<li>… and {warnings.length - 50} more.</li>{/if}
      </ul>
    </details>
  {/if}

  <div class="tree" role="tree" aria-label={system.name} aria-multiselectable="true">
    {#if rows.length === 0}
      <p class="empty">{#if query}No codes match “{query}”.{:else}No codes to show.{/if}</p>
    {/if}
    {#each rows as { node, hasChildren } (node.code)}
      {@const count = counts.get(node.code) ?? 0}
      {@const isSelected = selected.has(node.code)}
      {@const isNoMatch = noMatchCodes.has(node.code)}
      {@const isMapped = count > 0 || isNoMatch}
      {@const isLocked = uniqueMappingOnly && isMapped && !isSelected}
      <div
        class="node"
        class:selected={isSelected}
        class:mapped={isMapped}
        class:locked={isLocked}
        role="treeitem"
        aria-selected={isSelected}
        aria-disabled={isLocked}
        tabindex="0"
        draggable="true"
        title={isLocked
          ? 'Already part of another mapping — turn off “Only allow each code to be mapped once” to reuse it here'
          : node.description || undefined}
        style="padding-left: {node.depth * 16 + 8}px"
        onclick={() => select(node.code, isLocked)}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), select(node.code, isLocked))}
        ondragstart={(e) => {
          e.dataTransfer.setData('text/plain', node.code);
          e.dataTransfer.setData('application/x-crosswalk-side', accent);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onmouseenter={() => onHover?.(node.code)}
        onmouseleave={() => onHover?.(null)}
      >
        {#if hasChildren}
          <button
            class="twist"
            aria-label={expanded.has(node.code) ? 'Collapse' : 'Expand'}
            onclick={(e) => {
              e.stopPropagation();
              toggle(node.code);
            }}
          >
            <span class:open={expanded.has(node.code) || normalizedQuery}>▶</span>
          </button>
        {:else}
          <span class="twist spacer"></span>
        {/if}
        <span class="code">{#each highlight(node.code) as p}<span class:hit={p.hit}>{p.t}</span>{/each}</span>
        <span class="desc">{#each highlight(node.title) as p}<span class:hit={p.hit}>{p.t}</span>{/each}</span>
        {#if isNoMatch}
          <span class="badge nomatch" title="Marked as no match">∅ no match</span>
        {:else if count > 0}
          <span class="badge" title="{count} mapping{count > 1 ? 's' : ''}">{count}</span>
        {/if}
        {#if hasChildren}
          <button
            class="select-unmapped"
            title="Select all not-yet-mapped codes under {node.code}"
            aria-label="Select all not-yet-mapped codes under {node.code}"
            onclick={(e) => {
              e.stopPropagation();
              selectUnmapped(node.code);
            }}
          >
            ◎
          </button>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    min-height: 0;
    overflow: hidden;
  }
  header {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .titlerow {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .name-label {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-weight: 700;
    padding: 3px 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name-input {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    box-shadow: 0 0 0 3px var(--accent-soft);
    border-color: var(--accent);
  }
  .icon-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    padding: 5px;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    transition: background 0.12s ease, color 0.12s ease;
  }
  .icon-btn :global(svg) {
    width: 14px;
    height: 14px;
    fill: currentColor;
    display: block;
  }
  .icon-btn:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .controls {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .controls input {
    flex: 1;
    min-width: 0;
  }
  button.small {
    padding: 5px 8px;
    font-size: 12px;
  }
  .meta {
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .selcount {
    color: var(--accent);
    font-weight: 600;
  }
  .progress {
    margin-top: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .progress-track {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--border);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: inherit;
    transition: width 0.15s ease;
  }
  .progress-label {
    flex: none;
    font-size: 11px;
    color: var(--text-muted);
  }
  .linky {
    border: none;
    background: none;
    padding: 0 0 0 2px;
    color: var(--accent);
    font-size: 11px;
    text-decoration: underline;
  }
  .warnings {
    border-bottom: 1px solid var(--warning-border);
    background: var(--warning-bg);
    color: var(--warning-text);
    padding: 8px 12px;
    font-size: 12px;
  }
  .warnings summary {
    cursor: pointer;
    font-weight: 600;
  }
  .warnings ul {
    margin: 6px 0 0;
    padding-left: 18px;
    max-height: 140px;
    overflow: auto;
  }
  .tree {
    overflow-y: auto;
    overflow-x: hidden; /* long descriptions ellipsize rather than scroll the panel */
    flex: 1;
    min-height: 0;
    padding: 4px 0;
  }
  .empty {
    color: var(--text-muted);
    padding: 12px;
    text-align: center;
  }
  .node {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    cursor: pointer;
    border-left: 3px solid transparent;
  }
  .node:hover {
    background: var(--surface-2);
  }
  .node.selected {
    background: var(--accent-soft);
    border-left-color: var(--accent);
  }
  .node.mapped .code,
  .node.mapped .desc {
    opacity: 0.55;
  }
  .node.locked {
    cursor: not-allowed;
  }
  .node.locked:hover {
    background: none;
  }
  .twist {
    border: none;
    background: none;
    padding: 4px;
    margin: -4px;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    flex: none;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .twist:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .twist span {
    font-size: 9px;
    transition: transform 0.12s ease;
  }
  .twist span.open {
    transform: rotate(90deg);
  }
  .twist.spacer {
    display: inline-block;
  }
  .select-unmapped {
    border: none;
    background: none;
    padding: 2px;
    width: 20px;
    height: 20px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    opacity: 0;
    transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
  }
  .node:hover .select-unmapped,
  .select-unmapped:focus-visible {
    opacity: 1;
  }
  .select-unmapped:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .code {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-weight: 600;
    font-size: 12px;
    flex: none;
  }
  .desc {
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
  .hit {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    border-radius: 2px;
  }
  .badge {
    flex: none;
    font-size: 11px;
    font-weight: 600;
    min-width: 18px;
    text-align: center;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .badge.nomatch {
    background: var(--surface-2);
    color: var(--text-muted);
    border: 1px solid var(--border);
    font-weight: 500;
  }
</style>
