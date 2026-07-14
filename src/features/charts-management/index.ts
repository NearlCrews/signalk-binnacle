let chartsManagementPanelModule:
  | Promise<typeof import('./ChartsManagementPanel.svelte')>
  | undefined;

export function loadChartsManagementPanel(): Promise<
  typeof import('./ChartsManagementPanel.svelte')
> {
  chartsManagementPanelModule ??= import('./ChartsManagementPanel.svelte').catch(
    (error: unknown) => {
      chartsManagementPanelModule = undefined;
      throw error;
    },
  );
  return chartsManagementPanelModule;
}
