import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// `base` must match the GitHub Pages sub-path (https://<user>.github.io/crosswalk-generator/).
// Override with BASE_PATH=/ for local root hosting or a custom domain.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/crosswalk-generator/',
  plugins: [svelte()],
});
