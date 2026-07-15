<script>
  import Toolbar from './components/Toolbar.svelte';
  import SystemPanel from './components/SystemPanel.svelte';
  import MappingBar from './components/MappingBar.svelte';
  import MappingList from './components/MappingList.svelte';
  import FastTooltip from './components/FastTooltip.svelte';
  import {
    systemA,
    systemB,
    mappings,
    selectionA,
    selectionB,
    mappingCounts,
    toggleSelection,
    clearSelection,
    addToSelection,
    hoverA,
    hoverB,
    focusA,
    focusB,
    makeSystem,
  } from './lib/stores.js';
  import { parseCsv, guessColumns } from './lib/csv.js';
  import { app as strings } from './lib/strings.js';

  // The one-click demo pair loaded by the banner below — both sides at once,
  // paired so a first-time user has a working crosswalk to explore immediately.
  const DEMO_DATASET_A = { file: '2022_NAICS_Descriptions.csv', name: 'NAICS industry classification system' };
  const DEMO_DATASET_B = { file: 'NACE_Rev2.1_Heading_EN.csv', name: 'NACE industry classification system' };

  let demoLoading = $state(false);
  let demoError = $state('');

  // The banner offering the demo data is only relevant while neither side has
  // any data of its own — it has no dismiss button, so it reappears any time
  // both systems become empty again (e.g. after replacing both files, or a
  // Restart), not just once at the start of the session.
  let showDemoBanner = $derived(!$systemA && !$systemB);

  async function loadDemoDataset({ file, name }) {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/${file}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    const { fields, rows } = await parseCsv(text);
    if (!fields.length || !rows.length) throw new Error(`${file} has no readable rows`);
    const guess = guessColumns(fields, rows);
    const colMap = {
      level: null,
      code: guess.code,
      title: guess.title,
      description: guess.description,
      autoLevel: true,
      autoParents: false,
    };
    return makeSystem(name, rows, colMap);
  }

  async function loadDemoData() {
    demoError = '';
    demoLoading = true;
    try {
      const [a, b] = await Promise.all([loadDemoDataset(DEMO_DATASET_A), loadDemoDataset(DEMO_DATASET_B)]);
      systemA.set(a);
      systemB.set(b);
      clearSelection(selectionA);
      clearSelection(selectionB);
    } catch (e) {
      demoError = strings.demoLoadError(e.message ?? e);
    } finally {
      demoLoading = false;
    }
  }

  function linked() {
    // Per the UX decision, clear both selections after creating links / no-match.
    clearSelection(selectionA);
    clearSelection(selectionB);
  }
</script>

<div class="app">
  <Toolbar mappingCount={$mappings.length} />

  {#if showDemoBanner}
    <div class="demo-banner">
      <span class="demo-text">
        {strings.demoPrompt}
        <button class="demo-link" onclick={loadDemoData} disabled={demoLoading}>
          {demoLoading ? strings.loadingDemo : strings.tryDemoButton}
        </button>
      </span>
      {#if demoError}<span class="demo-error">{demoError}</span>{/if}
    </div>
  {/if}

  <main>
    <section class="side">
      <SystemPanel
        title={strings.systemATitle}
        accent="A"
        bind:system={$systemA}
        selected={$selectionA}
        counts={$mappingCounts.a}
        noMatchCodes={$mappingCounts.noMatchA}
        onToggle={(code) => toggleSelection(selectionA, code)}
        onClear={() => clearSelection(selectionA)}
        onHover={(code) => hoverA.set(code)}
        onSelectUnmapped={(codes) => addToSelection(selectionA, codes)}
        focusRequest={$focusA}
      />
    </section>

    <section class="center">
      <MappingBar
        systemA={$systemA}
        systemB={$systemB}
        selectionA={$selectionA}
        selectionB={$selectionB}
        onLinked={linked}
        onClearA={() => clearSelection(selectionA)}
        onClearB={() => clearSelection(selectionB)}
        onRemoveA={(code) => toggleSelection(selectionA, code)}
        onRemoveB={(code) => toggleSelection(selectionB, code)}
      />
      <MappingList
        mappings={$mappings}
        systemA={$systemA}
        systemB={$systemB}
      />
    </section>

    <section class="side">
      <SystemPanel
        title={strings.systemBTitle}
        accent="B"
        bind:system={$systemB}
        selected={$selectionB}
        counts={$mappingCounts.b}
        noMatchCodes={$mappingCounts.noMatchB}
        onToggle={(code) => toggleSelection(selectionB, code)}
        onClear={() => clearSelection(selectionB)}
        onHover={(code) => hoverB.set(code)}
        onSelectUnmapped={(codes) => addToSelection(selectionB, codes)}
        focusRequest={$focusB}
      />
    </section>
  </main>

  <footer>{@html strings.footerHtml}</footer>
</div>

<FastTooltip />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  main {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1.1fr 1fr;
    gap: 12px;
    padding: 12px;
  }
  section {
    min-height: 0;
    min-width: 0; /* allow grid tracks to share width instead of growing to content */
    display: flex;
    flex-direction: column;
  }
  .center {
    gap: 12px;
  }
  .demo-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 16px;
    background: var(--accent-soft);
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .demo-text {
    color: var(--text);
  }
  .demo-link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    font-weight: 600;
    text-decoration: underline;
    font-size: inherit;
  }
  .demo-error {
    color: var(--danger);
    font-size: 12px;
  }
  footer {
    padding: 8px 16px;
    font-size: 12px;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
    background: var(--surface);
    text-align: center;
  }
  @media (max-width: 900px) {
    .app {
      height: auto;
      min-height: 100vh;
    }
    main {
      grid-template-columns: 1fr;
    }
    section {
      max-height: 70vh;
    }
  }
</style>
