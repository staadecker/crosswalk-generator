<script>
  import { guessColumns } from '../lib/csv.js';
  import { fastTooltip } from '../lib/tooltip.js';
  import { columnMapper as strings } from '../lib/strings.js';

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
    {strings.confirmColumnsPrefix} <strong>{fileName}</strong>.
  </p>

  <div class="section">
    <h3 class="section-title">{strings.selectColumnsTitle}</h3>
    <div class="fields">
      <label>
        <span>
          {strings.codeColumnLabel}
          <span
            class="help"
            tabindex="0"
            use:fastTooltip={strings.codeColumnHelp}
            >?</span
          >
        </span>
        <select bind:value={codeCol}>
          <option value="">{strings.selectPlaceholder}</option>
          {#each fields as f}<option value={f}>{f}</option>{/each}
        </select>
      </label>
      <label>
        <span>
          {strings.titleColumnLabel}
          <span
            class="help"
            tabindex="0"
            use:fastTooltip={strings.titleColumnHelp}
            >?</span
          >
        </span>
        <select bind:value={titleCol}>
          <option value="">{strings.selectPlaceholder}</option>
          {#each fields as f}<option value={f}>{f}</option>{/each}
        </select>
      </label>
      <label>
        <span>
          {strings.descColumnLabel} <em>{strings.descColumnOptionalTag}</em>
          <span
            class="help"
            tabindex="0"
            use:fastTooltip={strings.descColumnHelp}
            >?</span
          >
        </span>
        <select bind:value={descCol}>
          <option value="">{strings.nonePlaceholder}</option>
          {#each fields as f}<option value={f}>{f}</option>{/each}
        </select>
      </label>
    </div>
  </div>

  <div class="section">
    <h3 class="section-title">{strings.configureNestingTitle}</h3>
    <div class="fields">
      <div class="question">
        <label class="checkbox">
          <input type="checkbox" bind:checked={dataIncludesParents} />
          <span>
            {strings.dataIncludesParentsLabel}
            <span
              class="help"
              tabindex="0"
              use:fastTooltip={strings.dataIncludesParentsHelp}
              >?</span
            >
          </span>
        </label>
        <p class="hint">
          {strings.parentsHint}
        </p>
      </div>
      <label class="level-field" class:disabled={!dataIncludesParents}>
        <span>
          {strings.levelColumnLabel}
          <span
            class="help"
            tabindex="0"
            use:fastTooltip={strings.levelColumnHelp}
            >?</span
          >
        </span>
        <select bind:value={levelCol} disabled={!dataIncludesParents}>
          <option value="">{strings.autoDetectOption}</option>
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
                {#if f === levelCol}<span class="tag">{strings.tagLevel}</span>{/if}
                {#if f === codeCol}<span class="tag">{strings.tagCode}</span>{/if}
                {#if f === titleCol}<span class="tag">{strings.tagTitle}</span>{/if}
                {#if f === descCol}<span class="tag">{strings.tagDescription}</span>{/if}
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
    <button class="ghost" onclick={() => onCancel?.()}>{strings.cancelButton}</button>
    <button class="primary" disabled={!canContinue} onclick={confirm}>
      {strings.buildButton}
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
