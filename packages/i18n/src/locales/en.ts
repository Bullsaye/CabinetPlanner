/**
 * English: the base catalogue. Every other locale is checked against these
 * keys. Placeholders use `{name}`.
 *
 * Key scheme:
 *   var.<name>                     variable label
 *   var.<name>.hint                variable help text
 *   group.<group>                  variable/option group heading
 *   option.<key> / option.<key>.<value>
 *   role.<role>                    part role name
 *   col.<column>                   cutlist column header
 *   diag.<code>                    diagnostic message
 *   layer.<layer>                  value source label
 *   cli.*                          command-line text
 */
export const en = {
  // Groups
  "group.dimensions": "Dimensions",
  "group.board": "Board",
  "group.construction": "Construction",
  "group.back": "Back panel",
  "group.shelves": "Shelves",
  "group.fronts": "Fronts",
  "group.materials": "Materials",
  "group.edges": "Edges",

  // Variables
  "var.W": "Width",
  "var.W.hint": "Overall carcase width.",
  "var.H": "Height",
  "var.H.hint": "Carcase height without plinth.",
  "var.D": "Depth",
  "var.D.hint": "Carcase depth without fronts.",
  "var.base_h": "Base cabinet height",
  "var.base_h.hint": "Carcase height of base cabinets, without plinth and worktop.",
  "var.worktop_d": "Worktop depth",
  "var.worktop_d.hint": "Used to derive the default cabinet depth.",
  "var.plinth_h": "Plinth height",
  "var.plinth_h.hint": "Height of legs or plinth below the carcase.",
  "var.t_carcase": "Carcase board",
  "var.t_carcase.hint": "Thickness of sides, bottom, top and rails. Follows the carcase material by default.",
  "var.t_back": "Back board",
  "var.t_back.hint": "Thickness of the back panel. Follows the back material by default.",
  "var.t_shelf": "Shelf board",
  "var.t_shelf.hint": "Thickness of shelves. Follows the shelf material by default.",
  "var.t_front": "Front board",
  "var.t_front.hint": "Thickness of doors and drawer fronts. Follows the front material by default.",
  "var.rail_w": "Rail width",
  "var.rail_w.hint": "Depth of the front and rear top rails.",
  "var.back_groove_offset": "Groove offset",
  "var.back_groove_offset.hint": "Distance from the rear edge of the carcase to the groove.",
  "var.back_groove_depth": "Groove depth",
  "var.back_groove_depth.hint": "How deep the back groove is cut into the carcase panels.",
  "var.back_rebate_depth": "Rebate depth",
  "var.back_rebate_depth.hint": "How deep the back rebate is cut into the carcase panels.",
  "var.back_play": "Back play",
  "var.back_play.hint": "Clearance per edge between the back panel and the bottom of its groove or rebate.",
  "var.shelf_count": "Shelves",
  "var.shelf_count.hint": "Number of adjustable shelves.",
  "var.shelf_gap": "Shelf side gap",
  "var.shelf_gap.hint": "Clearance per side between shelf and carcase side.",
  "var.shelf_front_setback": "Shelf front setback",
  "var.shelf_front_setback.hint": "How far shelves sit back from the carcase front edge.",
  "var.shelf_back_gap": "Shelf back gap",
  "var.shelf_back_gap.hint": "Clearance between shelf and back panel.",
  "var.door_count": "Doors",
  "var.door_count.hint": "Number of doors: 0, 1 or 2.",
  "var.front_gap": "Front gap",
  "var.front_gap.hint": "Gap between neighbouring fronts.",
  "var.front_gap_top": "Gap above fronts",
  "var.front_gap_top.hint": "Gap between the top of the fronts and the top of the carcase.",
  "var.front_gap_bottom": "Gap below fronts",
  "var.front_gap_bottom.hint": "Offset of the fronts from the bottom of the carcase. Negative values overhang.",
  "var.front_gap_side": "Side gap",
  "var.front_gap_side.hint": "Gap at the outer left and right of the fronts; half the front gap by default.",

  // Options
  "option.carcase_joint": "Carcase joint",
  "option.carcase_joint.sides_over": "Sides over bottom and top",
  "option.carcase_joint.sides_between": "Sides between bottom and top",
  "option.top": "Top",
  "option.top.full": "Full top panel",
  "option.top.rails": "Front and rear rails",
  "option.back_mount": "Back mount",
  "option.back_mount.groove": "In groove",
  "option.back_mount.rebate": "In rebate",
  "option.back_mount.surface": "Surface mounted",
  "option.material.carcase": "Carcase material",
  "option.material.back": "Back material",
  "option.material.shelf": "Shelf material",
  "option.material.front": "Front material",
  "option.edge.carcase": "Carcase edge",
  "option.edge.shelf": "Shelf edge",
  "option.edge.front": "Front edge",
  "option.edge.deduct": "Deduct edge thickness from cut size",
  "option.edge.none": "No edge",

  // Part roles
  "role.side_left": "Side L",
  "role.side_right": "Side R",
  "role.side_pair": "Side L/R",
  "role.bottom": "Bottom",
  "role.top": "Top",
  "role.rail_front": "Front rail",
  "role.rail_rear": "Rear rail",
  "role.rail_pair": "Rail",
  "role.back": "Back",
  "role.shelf": "Shelf",
  "role.door": "Door",

  // Cutlist columns
  "col.part": "Part",
  "col.cabinet": "Cabinet",
  "col.role": "Name",
  "col.material": "Material",
  "col.length": "L",
  "col.width": "W",
  "col.thickness": "T",
  "col.cut_length": "Cut L",
  "col.cut_width": "Cut W",
  "col.qty": "Qty",
  "col.grain": "Grain",
  "col.edge_l1": "Edge L1",
  "col.edge_l2": "Edge L2",
  "col.edge_w1": "Edge W1",
  "col.edge_w2": "Edge W2",
  "col.note": "Note",

  // Value sources
  "layer.factory": "Factory",
  "layer.shop": "Shop",
  "layer.project": "Project",
  "layer.cabinet": "Override",

  // Severity
  "severity.error": "Error",
  "severity.warning": "Warning",

  // Diagnostics: variables and expressions
  "diag.var_shadows_constant": "{name} is set from the material and cannot be defined directly.",
  "diag.var_not_finite": "{name} is not a finite number.",
  "diag.var_unknown_reference": "{name} refers to unknown variable {ref}.",
  "diag.var_cycle": "Circular reference: {path}.",
  "diag.var_not_integer": "{name} must be a whole number (is {value}).",
  "diag.var_below_min": "{name} is {value}, below the minimum of {min}.",
  "diag.var_above_max": "{name} is {value}, above the maximum of {max}.",
  "diag.expr_unexpected_char": "{name}: unexpected character “{char}” at position {at}.",
  "diag.expr_unexpected_token": "{name}: unexpected “{token}” at position {at}.",
  "diag.expr_unexpected_end": "{name}: the expression ends too early.",
  "diag.expr_invalid_number": "{name}: “{text}” is not a valid number.",
  "diag.expr_unknown_function": "{name}: unknown function {fn}().",
  "diag.expr_wrong_arg_count": "{name}: {fn}() takes {expected} argument(s), got {got}.",
  "diag.expr_unknown_variable": "{name}: unknown variable {ref}.",
  "diag.expr_division_by_zero": "{name}: division by zero.",
  "diag.expr_not_finite": "{name}: the result is not a finite number.",
  "diag.expr_empty": "{name}: the expression is empty.",

  // Diagnostics: options and presets
  "diag.option_unknown": "Unknown option {key} in the {layer} layer.",
  "diag.option_invalid_value": "{key} cannot be “{value}”. Allowed: {allowed}.",
  "diag.material_unknown": "{key}: material “{value}” is not in the library.",
  "diag.edgeband_unknown": "{key}: edgeband “{value}” is not in the library.",
  "diag.preset_unknown": "Preset “{id}” used in the {layer} layer does not exist.",
  "diag.thickness_differs_from_material": "{name} is {value} mm but the material is {material} mm thick.",

  // Diagnostics: cabinet rules
  "diag.back_groove_too_deep": "The back groove ({depth} mm) is as deep as or deeper than the board ({thickness} mm).",
  "diag.back_rebate_too_deep": "The back rebate ({depth} mm) is as deep as or deeper than the board ({thickness} mm).",
  "diag.rails_overlap": "Front and rear rails ({rail_w} mm) overlap in a carcase {depth} mm deep.",
  "diag.part_nonpositive": "{part} has no positive size ({length} × {width} × {thickness}).",
  "diag.part_thickness_differs_from_material": "{part} is {thickness} mm thick but its material is {material} mm.",
  "diag.part_override_unused": "There is an override for part {code}, but this cabinet has no such part.",

  // CLI
  "cli.no_cabinets": "The project has no cabinets.",
  "cli.errors_block_output": "Errors found; no output written.",
  "cli.summary": "{errors} error(s), {warnings} warning(s).",
  "cli.written": "Written: {file}",
  "cli.col.variable": "Variable",
  "cli.col.value": "Value",
  "cli.col.expression": "Expression",
  "cli.col.source": "Source",
} as const;

export type MessageKey = keyof typeof en;
