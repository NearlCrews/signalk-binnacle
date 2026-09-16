<script lang="ts">
import type { LatLon } from '$shared/geo';
import UnitField from './UnitField.svelte';

interface Props {
  position: LatLon;
  onChange: (position: LatLon) => void;
  disabled?: boolean;
}

const { position, onChange, disabled = false }: Props = $props();
</script>

<div class="position-fields" role="group" aria-label="Position in decimal degrees">
  <UnitField
    label="Latitude"
    unit="°"
    ariaLabel="Latitude in degrees north, negative for south"
    value={position.latitude}
    min={-90}
    max={90}
    step="any"
    inputWidth="8rem"
    {disabled}
    onCommit={(latitude) => onChange({ ...position, latitude })}
  />
  <UnitField
    label="Longitude"
    unit="°"
    ariaLabel="Longitude in degrees east, negative for west"
    value={position.longitude}
    min={-180}
    max={180}
    step="any"
    inputWidth="8rem"
    {disabled}
    onCommit={(longitude) => onChange({ ...position, longitude })}
  />
</div>

<style>
.position-fields {
  display: grid;
  gap: var(--space-2);
  min-inline-size: 0;
}
</style>
