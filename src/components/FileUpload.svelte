<script>
  let { label = 'Upload CSV', hint = '', onFile } = $props();

  let dragging = $state(false);
  let inputEl;

  function emit(file) {
    if (file) onFile?.(file);
  }

  function onInputChange(e) {
    emit(e.target.files?.[0]);
    e.target.value = ''; // allow re-uploading the same filename
  }

  function onDrop(e) {
    e.preventDefault();
    dragging = false;
    emit(e.dataTransfer?.files?.[0]);
  }
</script>

<div
  class="dropzone"
  class:dragging
  role="button"
  tabindex="0"
  onclick={() => inputEl.click()}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), inputEl.click())}
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M12 16V4m0 0L8 8m4-4l4 4M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"
    />
  </svg>
  <div class="label">{label}</div>
  <div class="hint">Drag &amp; drop or click to choose a .csv file</div>
  {#if hint}<div class="hint muted">{hint}</div>{/if}
  <input bind:this={inputEl} type="file" accept=".csv,text/csv" onchange={onInputChange} hidden />
</div>

<style>
  .dropzone {
    border: 1.5px dashed var(--border);
    border-radius: var(--radius);
    padding: 28px 16px;
    text-align: center;
    color: var(--text-muted);
    background: var(--surface);
    transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
  }
  .dropzone:hover,
  .dropzone.dragging {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-soft);
  }
  .label {
    margin-top: 8px;
    font-weight: 600;
    color: var(--text);
  }
  .hint {
    font-size: 12px;
    margin-top: 4px;
  }
  .hint.muted {
    opacity: 0.8;
  }
</style>
