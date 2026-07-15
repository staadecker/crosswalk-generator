<script>
  import { tooltipState } from '../lib/tooltip.js';
</script>

{#if $tooltipState}
  <div class="fast-tooltip" style="left: {$tooltipState.x}px; top: {$tooltipState.y}px">
    {$tooltipState.text}
  </div>
{/if}

<style>
  .fast-tooltip {
    position: fixed;
    z-index: 1000;
    transform: translate(-50%, calc(-100% - 6px));
    background: var(--text);
    color: var(--surface);
    font-size: 11px;
    line-height: 1.4;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow);
    max-width: 320px;
    pointer-events: none;
  }
</style>
