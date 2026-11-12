/**
 * State of the 3D view that lasts for the session only (D74): parts hidden
 * to look inside, and the section plane. Not saved, not part of the project.
 */
export type SectionAxis = "x" | "y" | "z";

export const view3d = $state({
  /** Ids of hidden parts. */
  hidden: [] as string[],
  /** Section plane: on, the axis it cuts along, its place (0…1 across the cabinets) and which half stays. */
  section: false,
  axis: "z" as SectionAxis,
  pos: 0.6,
  flip: false,
});
