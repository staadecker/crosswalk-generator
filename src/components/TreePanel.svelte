<script>
  import { tick, untrack } from 'svelte';
  import { flattenTree, expandToLeaves, leafCodesOf, compactCodes } from '../lib/hierarchy.js';
  import editIcon from '@material-design-icons/svg/filled/edit.svg?raw';
  import { treePanel as strings } from '../lib/strings.js';

  let {
    system, // { name, tree, colMap, rows }
    selected = new Set(), // Set of selected codes on this side
    counts = new Map(), // code -> mapping count for this side
    noMatchCodes = new Set(), // codes flagged no-match on this side
    accent = 'A', // 'A' | 'B' for subtle color differentiation
    onToggle,
    onClear,
    onChange,
    onRename, // called with a new dataset name (used in export filenames)
    onHover, // called with the hovered code, or null on leave — drives Mappings-pane highlight
    onSelectUnmapped, // called with an array of not-yet-mapped leaf codes under a node
    focusRequest = null, // { code, ts } | null — reveal (expand/scroll/flash) a code, e.g. from a Mappings-pane bubble click
  } = $props();

  let treeEl;
  let flashedCode = $state(null);
  let flashTimer;

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

  // Default: expand roots so the tree isn't a wall of top-level codes only —
  // but only once per loaded tree, not any time `expanded` later happens to
  // become empty. Keying this off `system.tree`'s own identity (a fresh
  // object every time a hierarchy is (re)built, see makeSystem/loadProject in
  // stores.js) rather than `expanded.size` matters: the old size-based check
  // fired again every time the user collapsed the last remaining open
  // section, silently re-expanding every root right back out from under them
  // (a regression that also made the "Collapse" button look like it did
  // nothing at the top level).
  let expandedForTree = null;
  $effect(() => {
    if (system && system.tree !== expandedForTree) {
      expandedForTree = system.tree;
      expanded = new Set(system.tree.roots.map((r) => r.code));
      allExpanded = false;
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

  // Searching no longer force-opens every matching section on every render
  // (see flattenTree) — that made it impossible to collapse a section that's
  // part of the search results. Instead, starting or refining a search
  // auto-reveals matches once, by expanding their ancestors; the user is then
  // free to collapse any of those sections without them springing back open.
  //
  // Two bits of bookkeeping make that work across keystrokes:
  // - `userOwnedCodes`: codes the user has manually toggled since the current
  //   search began. The effect below never adds or removes these, in either
  //   direction, no matter what the query does next.
  // - `searchAutoExpanded`: codes currently expanded purely because *this*
  //   effect added them (not the user, not the default root-expand). When a
  //   later keystroke narrows the query, sections in here that are no longer
  //   needed get retracted again. Without this, a broad early keystroke
  //   (e.g. a single common letter matching almost everything) would expand
  //   huge parts of the tree and leave it that way forever, since additions
  //   alone never shrink back down as the query is refined.
  // `untrack` keeps this effect from re-firing off its own writes to
  // `expanded` — it only reacts to the query itself changing.
  let userOwnedCodes = new Set();
  let searchAutoExpanded = new Set();

  $effect(() => {
    if (!system || !normalizedQuery) {
      // Leaving a search (query cleared, or none started yet): put back
      // whatever the search itself opened and the user hasn't claimed as
      // their own, so a finished search doesn't leave the tree permanently
      // more expanded than it was before — this is what previously made a
      // search "leak" into a fully-exploded tree once the box was cleared.
      if (searchAutoExpanded.size) {
        const next = new Set(expanded);
        let changed = false;
        for (const a of searchAutoExpanded) {
          if (!userOwnedCodes.has(a) && next.has(a)) {
            next.delete(a);
            changed = true;
          }
        }
        if (changed) expanded = next;
      }
      userOwnedCodes = new Set();
      searchAutoExpanded = new Set();
      return;
    }
    const q = normalizedQuery;
    const tree = system.tree;
    untrack(() => {
      const needed = new Set();
      const walk = (node, ancestors) => {
        let anyMatch =
          node.code.toLowerCase().includes(q) || node.title.toLowerCase().includes(q);
        const nextAncestors = [...ancestors, node.code];
        for (const child of tree.childrenOf.get(node.code) ?? []) {
          if (walk(child, nextAncestors)) anyMatch = true;
        }
        if (anyMatch) {
          for (const a of ancestors) needed.add(a);
        }
        return anyMatch;
      };
      tree.roots.forEach((r) => walk(r, []));

      const next = new Set(expanded);
      let changed = false;

      // Retract sections this search previously opened but no longer needs.
      // Only codes *this effect* actually flipped open are tracked here —
      // never a section that happened to already be open for some other
      // reason (e.g. the default root-expand) — so this never collapses
      // something search didn't itself cause.
      for (const a of searchAutoExpanded) {
        if (userOwnedCodes.has(a)) {
          searchAutoExpanded.delete(a); // ownership already transferred to the user; stop tracking it here
        } else if (!needed.has(a)) {
          if (next.has(a)) {
            next.delete(a);
            changed = true;
          }
          searchAutoExpanded.delete(a);
        }
      }

      // Add newly-needed ancestors that aren't already expanded by anything.
      for (const a of needed) {
        if (!userOwnedCodes.has(a) && !next.has(a)) {
          next.add(a);
          searchAutoExpanded.add(a); // remember search caused this, so it can be retracted later
          changed = true;
        }
      }

      if (changed) expanded = next;
    });
  });

  // Reveal a code requested from elsewhere (e.g. clicking a bubble in the
  // Mappings pane): expand every ancestor so it's actually in the flattened
  // row list, clear any active search filter that might otherwise hide it
  // regardless of expand state, scroll it into view, then flash it briefly.
  // `req` is a fresh object each time (see focusCode in stores.js), so the
  // effect re-fires even when the same code is clicked twice in a row.
  $effect(() => {
    const req = focusRequest;
    if (!req || !system) return;
    const code = req.code;
    untrack(() => {
      revealCode(code);
    });
  });

  async function revealCode(code) {
    if (!system.tree.byCode.has(code)) return;
    query = '';
    const next = new Set(expanded);
    let changed = false;
    let parent = system.tree.byCode.get(code)?.parent;
    while (parent) {
      if (!next.has(parent)) {
        next.add(parent);
        changed = true;
      }
      parent = system.tree.byCode.get(parent)?.parent;
    }
    if (changed) expanded = next;
    await tick();
    const el = treeEl?.querySelector(`[data-code="${CSS.escape(code)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    clearTimeout(flashTimer);
    flashedCode = code;
    flashTimer = setTimeout(() => {
      flashedCode = null;
    }, 1400);
  }

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

  // Per-node mapped/total leaf counts (bottom-up), driving both the fraction
  // badges shown on ancestor nodes and the auto-collapse-when-complete effect
  // below — computed once per render rather than re-walking each node's whole
  // subtree via expandToLeaves.
  let nodeProgress = $derived.by(() => {
    const map = new Map();
    if (!system) return map;
    const { childrenOf } = system.tree;
    const visit = (node) => {
      const children = childrenOf.get(node.code) ?? [];
      if (children.length === 0) {
        const mapped = (counts.get(node.code) ?? 0) > 0 || noMatchCodes.has(node.code) ? 1 : 0;
        const p = { mapped, total: 1 };
        map.set(node.code, p);
        return p;
      }
      let mapped = 0;
      let total = 0;
      for (const child of children) {
        const p = visit(child);
        mapped += p.mapped;
        total += p.total;
      }
      const p = { mapped, total };
      map.set(node.code, p);
      return p;
    };
    system.tree.roots.forEach(visit);
    return map;
  });

  // Auto-collapse a section the moment every code beneath it becomes mapped —
  // but only on that transition, not on every render, so a user who reopens an
  // already-complete section (e.g. to double-check it) doesn't get fought.
  let seenComplete = new Set();
  $effect(() => {
    if (!system) return;
    const progress = nodeProgress;
    untrack(() => {
      const next = new Set(expanded);
      let changed = false;
      for (const [code, p] of progress) {
        const complete = p.total > 0 && p.mapped === p.total;
        if (complete) {
          if (!seenComplete.has(code)) {
            seenComplete.add(code);
            if (next.has(code)) {
              next.delete(code);
              changed = true;
            }
          }
        } else {
          seenComplete.delete(code);
        }
      }
      if (changed) expanded = next;
    });
  });

  function toggle(code) {
    const next = new Set(expanded);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    expanded = next;
    // A manual toggle takes permanent ownership of this section away from the
    // search auto-expand effect, so a later keystroke can neither force it
    // back open nor retract it out from under the user.
    userOwnedCodes.add(code);
  }

  function expandAll() {
    if (!system) return;
    expanded = new Set(system.tree.nodes.filter((n) => (system.tree.childrenOf.get(n.code) ?? []).length).map((n) => n.code));
    allExpanded = true;
    userOwnedCodes = new Set();
    searchAutoExpanded = new Set();
  }

  function collapseAll() {
    expanded = new Set();
    allExpanded = false;
    userOwnedCodes = new Set();
    searchAutoExpanded = new Set();
  }

  function select(code, locked) {
    if (locked) return; // already mapped elsewhere — refuse the click outright
    onToggle?.(code); // click toggles membership in the selection set
  }

  // A node with children isn't individually selected by clicking it while
  // unselected — that instead runs "select unmapped" over its whole subtree
  // (same action as the old dedicated button, now folded into the row itself
  // since a separate button was redundant once this became the row's own
  // click behavior). It *can* end up selected though — e.g. selectUnmapped's
  // own compaction, or a fully-mapped parent's bubble display, can leave a
  // parent code itself in the selection set — and clicking it again must
  // deselect it like any other selected code, not re-run select-unmapped
  // (which could unexpectedly grow the selection instead of clearing it, and
  // — reported regression — previously left it stuck selected with no way to
  // click it back off). Leaf nodes keep their normal toggle-select behavior.
  function nodeClick(node, hasChildren, locked, isSelected) {
    if (hasChildren) {
      if (isSelected) {
        onToggle?.(node.code);
        return;
      }
      selectUnmapped(node.code);
      return;
    }
    select(node.code, locked);
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
    <div class="side-label">{strings.systemLabel(accent)}</div>
    <div class="titlerow">
      <div class="name-wrap">
        {#if editingName}
          <input
            class="name-input"
            value={system.name}
            title={strings.datasetNameTitle}
            aria-label={strings.datasetNameAriaLabel}
            use:autofocus
            onblur={(e) => stopEditName(e.target.value)}
            onkeydown={(e) => {
              if (e.key === 'Enter') e.target.blur();
              else if (e.key === 'Escape') stopEditName();
            }}
          />
        {:else}
          <span class="name-label" title={strings.datasetNameTitle}>{system.name}</span>
          <button
            class="icon-btn"
            title={strings.renameDatasetTitle}
            aria-label={strings.renameAriaLabel(system.name)}
            onclick={() => (editingName = true)}
          >
            {@html editIcon}
          </button>
        {/if}
      </div>
      <button
        class="danger small"
        onclick={() => onChange?.()}
        title={strings.replaceFileTitle}
      >
        {strings.replaceFileButton}
      </button>
    </div>
    <div class="controls">
      <input
        type="search"
        placeholder={strings.searchPlaceholder}
        bind:value={query}
        aria-label={strings.searchAriaLabel(system.name)}
      />
      <button class="ghost small" onclick={expandAll} title={strings.expandTitle}>{strings.expandButton}</button>
      <button class="ghost small" onclick={collapseAll} title={strings.collapseTitle}>{strings.collapseButton}</button>
    </div>
    {#if selected.size > 0}
      <div class="meta">
        <span class="selcount">
          {strings.selectedCount(selected.size)}
          <button class="linky" onclick={() => onClear?.()}>{strings.clearButton}</button>
        </span>
      </div>
    {/if}
    <div
      class="progress"
      role="progressbar"
      aria-label={strings.progressAriaLabel(system.name)}
      aria-valuenow={leafMapped}
      aria-valuemin="0"
      aria-valuemax={leafTotal}
    >
      <div class="progress-track">
        <div class="progress-fill" class:complete={progressPct === 100} style="width: {progressPct}%"></div>
      </div>
      <span class="progress-label">{strings.progressLabel(leafMapped, leafTotal)}</span>
    </div>
  </header>

  {#if warnings.length}
    <details class="warnings">
      <summary>{strings.warningsSummary(warnings.length)}</summary>
      <ul>
        {#each warnings.slice(0, 50) as w}<li>{w}</li>{/each}
        {#if warnings.length > 50}<li>{strings.moreWarnings(warnings.length - 50)}</li>{/if}
      </ul>
    </details>
  {/if}

  <div class="tree" role="tree" aria-label={system.name} aria-multiselectable="true" bind:this={treeEl}>
    {#if rows.length === 0}
      <p class="empty">{#if query}{strings.noMatchQuery(query)}{:else}{strings.noCodesToShow}{/if}</p>
    {/if}
    {#each rows as { node, hasChildren } (node.code)}
      {@const count = counts.get(node.code) ?? 0}
      {@const isSelected = selected.has(node.code)}
      {@const isNoMatch = noMatchCodes.has(node.code)}
      {@const isMapped = count > 0 || isNoMatch}
      {@const isLocked = !hasChildren && isMapped && !isSelected}
      {@const progress = nodeProgress.get(node.code) ?? { mapped: 0, total: 0 }}
      {@const isFullyMapped = hasChildren ? progress.total > 0 && progress.mapped === progress.total : isMapped}
      <div
        class="node"
        class:selected={isSelected}
        class:mapped={isFullyMapped}
        class:locked={isLocked}
        class:flash={flashedCode === node.code}
        data-code={node.code}
        role="treeitem"
        aria-selected={isSelected}
        aria-disabled={isLocked}
        tabindex="0"
        draggable="true"
        title={node.description || undefined}
        style="padding-left: {node.depth * 16 + 8}px"
        onclick={() => nodeClick(node, hasChildren, isLocked, isSelected)}
        onkeydown={(e) =>
          (e.key === 'Enter' || e.key === ' ') &&
          (e.preventDefault(), nodeClick(node, hasChildren, isLocked, isSelected))}
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
            aria-label={expanded.has(node.code) ? strings.collapseButton : strings.expandButton}
            onclick={(e) => {
              e.stopPropagation();
              toggle(node.code);
            }}
          >
            <span class:open={expanded.has(node.code)}>▶</span>
          </button>
        {:else}
          <span class="twist spacer"></span>
        {/if}
        <span class="code">{#each highlight(node.code) as p}<span class:hit={p.hit}>{p.t}</span>{/each}</span>
        <span class="desc">{#each highlight(node.title) as p}<span class:hit={p.hit}>{p.t}</span>{/each}</span>
        {#if isNoMatch}
          <span class="badge nomatch" title={strings.noMatchBadgeTitle}>{strings.noMatchBadgeText}</span>
        {:else if !hasChildren}
          {#if count > 0}
            <span class="badge full leaf" title={strings.mappedBadgeTitle} aria-label={strings.mappedBadgeTitle}>✓</span>
          {/if}
        {:else}
          <span
            class="badge"
            class:zero={progress.mapped === 0}
            class:full={progress.total > 0 && progress.mapped === progress.total}
            title={strings.progressLabel(progress.mapped, progress.total)}
          >
            {progress.mapped}/{progress.total}
          </span>
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
  .side-label {
    font-size: 10px;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin-bottom: 0;
  }
  .titlerow {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .name-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .name-label {
    min-width: 0;
    font-size: 14px;
    font-weight: 700;
    padding: 1px 2px;
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
  .progress-fill.complete {
    background: var(--success);
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
    overflow-x: hidden; /* long titles wrap onto further lines rather than scroll the panel */
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
    align-items: flex-start;
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
  .node.locked:hover {
    background: none;
  }
  .node.flash {
    animation: flash-highlight 1.4s ease-out;
  }
  @keyframes flash-highlight {
    0%,
    35% {
      background: var(--accent-soft);
      box-shadow: inset 3px 0 0 0 var(--accent);
    }
    100% {
      background: transparent;
      box-shadow: inset 3px 0 0 0 transparent;
    }
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
  .code {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-weight: 600;
    font-size: 12px;
    flex: none;
    padding-top: 3px;
  }
  .desc {
    color: var(--text-muted);
    white-space: normal;
    overflow-wrap: anywhere;
    flex: 1;
    min-width: 0;
    padding-top: 3px;
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
  .badge.zero {
    background: var(--surface-2);
    color: var(--text-muted);
    border: 1px solid var(--border);
  }
  .badge.full {
    background: var(--success);
    color: var(--success-contrast);
  }
  .badge.leaf {
    font-size: 12px;
  }
</style>
