<script>
  import Toolbar from './components/Toolbar.svelte';
  import SystemPanel from './components/SystemPanel.svelte';
  import MappingBar from './components/MappingBar.svelte';
  import MappingList from './components/MappingList.svelte';
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
    demoBannerDismissed,
  } from './lib/stores.js';
  import { parseCsv, guessColumns } from './lib/csv.js';

  // The one-click demo pair loaded by the banner below — both sides at once,
  // paired so a first-time user has a working crosswalk to explore immediately.
  // TODO: samples/nace-sample.csv is a small stand-in until a full NACE CSV is
  // available; swap its `file` in for a full dataset once one is added.
  const DEMO_DATASET_A = { file: '2022_NAICS_Descriptions.csv', name: 'NAICS industry classification system' };
  const DEMO_DATASET_B = { file: 'nace-sample.csv', name: 'NACE industry classification system' };

  let demoLoading = $state(false);
  let demoError = $state('');

  // The banner offering the demo data is only relevant before either side has
  // any data of its own — once real (or demo) data is loaded on either side,
  // it disappears on its own, in addition to its own dismiss ("X") button.
  // `demoBannerDismissed` lives in stores.js (not local state) so Restart can
  // reset it and bring the banner back.
  let showDemoBanner = $derived(!$demoBannerDismissed && !$systemA && !$systemB);

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
      demoBannerDismissed.set(true);
    } catch (e) {
      demoError = `Could not load demo data: ${e.message ?? e}`;
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
        Just playing around?
        <button class="demo-link" onclick={loadDemoData} disabled={demoLoading}>
          {demoLoading ? 'Loading demo data…' : 'Try our demo data'}
        </button>
      </span>
      {#if demoError}<span class="demo-error">{demoError}</span>{/if}
      <button
        class="demo-dismiss"
        onclick={() => demoBannerDismissed.set(true)}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  {/if}

  <main>
    <section class="side">
      <SystemPanel
        title="System A"
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
        selectionA={$selectionA}
        selectionB={$selectionB}
      />
    </section>

    <section class="side">
      <SystemPanel
        title="System B"
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

  <footer>
    All data remains on your device (see <a href="https://github.com/staadecker/crosswalk-generator" target="_blank" rel="noopener">source code</a>). Outputs generated by
  Crosswalk Generator
  &copy; 2026 Martin Staadecker are licensed under
  <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
  </footer>
</div>

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
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 40px;
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
  .demo-dismiss {
    position: absolute;
    right: 16px;
    border: none;
    background: none;
    padding: 2px 6px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .demo-dismiss:hover {
    color: var(--text);
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
