<script>
  import { createEventDispatcher } from 'svelte';
  import { flattenTree } from '../lib/hierarchy.js';

  export let system;              // { name, tree, colMap, rows }
  export let selectedCode = null; // currently selected code (string|null)
  export let counts = new Map();  // code -> mapping count for this side
  export let accent = 'A';        // 'A' | 'B' for subtle color differentiation

  const dispatch = createEventDispatcher();

  let query = '';
  let expanded = new Set();
  let allExpanded = false;

  // Default: expand roots so the tree isn't a wall of top-level codes only.
  $: if (system && expanded.size === 0 && !allExpanded) {
    expanded = new Set(system.tree.roots.map((r) => r.code));
  }

  $: normalizedQuery = query.trim().toLowerCase();
  $: matcher = normalizedQuery
    ? (node) =>
        node.code.toLowerCase().includes(normalizedQuery) ||
        node.description.toLowerCase().includes(normalizedQuery)
    : null;

  $: rows = system ? flattenTree(system.tree, expanded, matcher) : [];
  $: warnings = system?.tree.warnings ?? [];

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

  function select(code) {
    dispatch('select', code === selectedCode ? null : code);
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
      <h2 title={system.name}>{system.name}</h2>
      <button class="ghost small" on:click={() => dispatch('change')} title="Replace this file">
        Change file
      </button>
    </div>
    <div class="controls">
      <input
        type="search"
        placeholder="Search code or description…"
        bind:value={query}
        aria-label="Search {system.name}"
      />
      <button class="ghost small" on:click={expandAll} title="Expand all">Expand</button>
      <button class="ghost small" on:click={collapseAll} title="Collapse all">Collapse</button>
    </div>
    <div class="meta">{system.tree.nodes.length} codes</div>
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

  <div class="tree" role="tree" aria-label={system.name}>
    {#if rows.length === 0}
      <p class="empty">No codes match “{query}”.</p>
    {/if}
    {#each rows as { node, hasChildren } (node.code)}
      {@const count = counts.get(node.code) ?? 0}
      <div
        class="node"
        class:selected={node.code === selectedCode}
        role="treeitem"
        aria-selected={node.code === selectedCode}
        tabindex="0"
        style="padding-left: {node.depth * 16 + 8}px"
        on:click={() => select(node.code)}
        on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), select(node.code))}
      >
        {#if hasChildren}
          <button
            class="twist"
            aria-label={expanded.has(node.code) ? 'Collapse' : 'Expand'}
            on:click|stopPropagation={() => toggle(node.code)}
          >
            <span class:open={expanded.has(node.code) || normalizedQuery}>▶</span>
          </button>
        {:else}
          <span class="twist spacer"></span>
        {/if}
        <span class="code">{#each highlight(node.code) as p}<span class:hit={p.hit}>{p.t}</span>{/each}</span>
        <span class="desc">{#each highlight(node.description) as p}<span class:hit={p.hit}>{p.t}</span>{/each}</span>
        {#if count > 0}
          <span class="badge" title="{count} mapping{count > 1 ? 's' : ''}">{count}</span>
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
    justify-content: space-between;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
  .twist {
    border: none;
    background: none;
    padding: 0;
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    flex: none;
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
</style>
