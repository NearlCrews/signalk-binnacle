// The admin-path explanation for a Signal K server with no resources provider behind a resource
// type: one wording wherever the dead end appears (tracks, routes, waypoints, the setup
// checklist), so the fix always reads the same. The consequence sentence names what is blocked;
// the enable step names the exact control, since tracks is a custom type in the built-in
// Resources Provider while the standard types are plain checkboxes there.
export function resourcesProviderNote(consequence: string, enableStep: string): string {
  return (
    `${consequence} An administrator can enable it: open the Signal K admin UI, choose Server, ` +
    `then Plugin Config, then Resources Provider (built-in), ${enableStep}, and submit.`
  );
}
