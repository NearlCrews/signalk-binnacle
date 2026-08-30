<script lang="ts">
import { SlideOver } from '$shared/ui';
import DisplaySettings from './DisplaySettings.svelte';
import type { DisplaySettingsController } from './display-settings.svelte';

interface Props {
  controller: DisplaySettingsController;
  onClose: () => void;
  onBack?: () => void;
}

const { controller, onClose, onBack }: Props = $props();
</script>

<SlideOver title="Display" closeLabel="Close display panel" {onClose} {onBack} bodyFlex>
  <p class="muted-note">
    Dim the screen for night watches, let the theme follow day and night, and size the text for
    reading distance.
  </p>
  <DisplaySettings {controller} />
</SlideOver>
