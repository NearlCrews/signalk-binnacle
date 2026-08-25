<script lang="ts">
// A label, value spec list shared by the chart detail panel and the import review step, so the two
// chart readouts share one definition and cannot drift. Each caller supplies its own rows and order.
interface SpecRow {
  label: string;
  value: string;
}

const { rows }: { rows: SpecRow[] } = $props();
</script>

<dl class="detail-list detail-list--wrap">
  {#each rows as row (row.label)}
    <div class="item">
      <dt>{row.label}</dt>
      <dd>{row.value}</dd>
    </div>
  {/each}
</dl>
