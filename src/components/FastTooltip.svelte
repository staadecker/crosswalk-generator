<script>
  import { tooltipState } from '../lib/tooltip.js';

  const MARGIN = 8;

  let el = $state(null);
  let pos = $state(null); // { left, top, flip } | null — clamped to the viewport

  // Runs after the div (re)mounts with its text, so `el`'s measured size
  // reflects the tooltip that's about to be shown.
  $effect(() => {
    const t = $tooltipState;
    if (!t || !el) {
      pos = null;
      return;
    }
    const rect = el.getBoundingClientRect();
    const halfWidth = rect.width / 2;
    let left = Math.max(halfWidth + MARGIN, t.x);
    left = Math.min(window.innerWidth - halfWidth - MARGIN, left);

    // Normally the tooltip sits above its anchor; flip below if there isn't
    // room above (e.g. the anchor is near the top of the viewport).
    const flip = t.y - rect.height - 6 < MARGIN;

    pos = { left, top: t.y, flip };
  });
</script>

{#if $tooltipState}
  <div
    class="fast-tooltip"
    class:flip={pos?.flip}
    bind:this={el}
    style={pos
      ? `left: ${pos.left}px; top: ${pos.top}px`
      : `left: ${$tooltipState.x}px; top: ${$tooltipState.y}px; visibility: hidden`}
  >
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
    width: max-content;
    max-width: 320px;
    pointer-events: none;
  }
  .fast-tooltip.flip {
    transform: translate(-50%, 6px);
  }
</style>
