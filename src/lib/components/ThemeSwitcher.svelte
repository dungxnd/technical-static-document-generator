<script lang="ts">
  import { Sun, Moon } from '@lucide/svelte';
  import { theme } from '../theme.svelte';

  let announcement = $state('');

  function toggle() {
    theme.toggle();
    announcement = `${theme.label} theme applied`;
  }
</script>

<button
  type="button"
  class="theme-switch btn btn-ghost btn-sm btn-square rounded-edge"
  onclick={toggle}
  aria-label={`Switch to ${theme.isDark ? 'light' : 'dark'} theme`}
  title={`${theme.label} — switch to ${theme.isDark ? 'light' : 'dark'} theme`}
>
  <!-- Both icons stay mounted so the swap animates rather than reflows. -->
  <span class="icon-slot" class:is-hidden={theme.isDark} aria-hidden="true">
    <Sun size={16} />
  </span>
  <span class="icon-slot" class:is-hidden={!theme.isDark} aria-hidden="true">
    <Moon size={16} />
  </span>
</button>

<p class="sr-only" role="status" aria-live="polite">{announcement}</p>

<style>
  /* Expands the hit area to the 44px touch minimum without enlarging the
     visual button. */
  .theme-switch {
    position: relative;
  }
  .theme-switch::after {
    content: '';
    position: absolute;
    inset: 50% 50%;
    width: max(100%, 44px);
    height: max(100%, 44px);
    transform: translate(-50%, -50%);
  }

  .icon-slot {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    transition:
      opacity 160ms ease-out,
      transform 160ms ease-out;
  }
  .icon-slot.is-hidden {
    opacity: 0;
    transform: scale(0.75) rotate(-45deg);
  }
</style>
