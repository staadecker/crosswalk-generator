import { writable } from 'svelte/store';

/**
 * Shared state for the app's fast-appearing tooltip (a replacement for the
 * native `title` attribute, which has a long, browser-controlled show delay).
 * A single <FastTooltip/> instance (mounted once, in App.svelte) renders
 * whatever this store holds; any number of elements across the app can point
 * at it via the `fastTooltip` action below.
 */
export const tooltipState = writable(null); // { text, x, y } | null

const SHOW_DELAY_MS = 150;

/**
 * Svelte action: shows the shared tooltip near `node` on hover/focus, after a
 * short delay, with text from `getText` (a string, or a function returning
 * one — evaluated lazily so it can depend on reactive state).
 */
export function fastTooltip(node, getText) {
  let timer;
  function show() {
    const text = typeof getText === 'function' ? getText() : getText;
    if (!text) return;
    const rect = node.getBoundingClientRect();
    timer = setTimeout(() => {
      tooltipState.set({ text, x: rect.left + rect.width / 2, y: rect.top });
    }, SHOW_DELAY_MS);
  }
  function hide() {
    clearTimeout(timer);
    tooltipState.set(null);
  }
  node.addEventListener('mouseenter', show);
  node.addEventListener('mouseleave', hide);
  node.addEventListener('focus', show);
  node.addEventListener('blur', hide);
  return {
    update(newGetText) {
      getText = newGetText;
    },
    destroy() {
      clearTimeout(timer);
      node.removeEventListener('mouseenter', show);
      node.removeEventListener('mouseleave', hide);
      node.removeEventListener('focus', show);
      node.removeEventListener('blur', hide);
    },
  };
}
