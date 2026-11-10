<script lang="ts">
  import type { ParamInput } from "@cabinet-planner/engine";
  import VarRow from "./VarRow.svelte";

  /** A cabinet parameter (D45) in the simple editor: a value row with the parameter's label, steppers and limits. */
  let { param }: { param: ParamInput } = $props();
</script>

<VarRow name={param.name} {param} />
