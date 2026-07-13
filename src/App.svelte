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
  } from './lib/stores.js';
</script>

<div class="app">
  <Toolbar mappingCount={$mappings.length} />

  <main>
    <section class="side">
      <SystemPanel
        title="System A (source)"
        accent="A"
        bind:system={$systemA}
        bind:selectedCode={$selectionA}
        counts={$mappingCounts.source}
      />
    </section>

    <section class="center">
      <MappingBar
        systemA={$systemA}
        systemB={$systemB}
        selectionA={$selectionA}
        selectionB={$selectionB}
        mappings={$mappings}
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
        title="System B (target)"
        accent="B"
        bind:system={$systemB}
        bind:selectedCode={$selectionB}
        counts={$mappingCounts.target}
      />
    </section>
  </main>

  <footer>
    Everything stays on your device — files are parsed in the browser and auto-saved to
    local storage. <a href="https://github.com" target="_blank" rel="noopener">Source</a>
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
