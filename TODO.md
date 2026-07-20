# Later work

## Per-panel rotation gizmo

- Replace shift-drag/free-orbit as the primary precision control with a small Blender-style
  orientation gizmo that appears on hover at the bottom-right of each panel.
- Use the conventional axis colours: X red, Y green, Z blue. Axis arrows or rings should lock a
  drag to yaw, pitch, or roll; clicking an axis/face should snap to a named orthogonal view.
- Keep the existing free orbit as an optional shortcut, but make the gizmo discoverable, precise,
  keyboard-accessible, and visually distinct from the panel resize and slice handles.
- Decide axis semantics in world/MNI space versus camera-local space, and show the choice clearly in
  the gizmo so rotations remain predictable after a panel has already been rolled.

## Template and surface flexibility

- Generalise a template bundle so the cortical surfaces, T1 cut volume, segmentation/classifier,
  optional white/inflated surfaces, and all voxel-to-world transforms are supplied and validated
  together. Do not infer correspondence merely because two assets both say “MNI152”.
- Add a registration/alignment QA view and fail loudly when a T1 footprint and cortical surface do
  not agree within a documented tolerance.
- Allow per-panel selection of pial, white, inflated, custom, or hidden surfaces without changing
  the statistical overlay representation.

## Statistical overlays on a cut face

- Default geometric rule: apply the same cut to cortex, anatomy, and voxel meshes; the opaque MRI
  cap hides all geometry behind it and is invisible from its back side.
- Add an explicit “overlay on cut” mode that samples each source statistical volume in a thin slab
  centred on the cut plane and composites thresholded colormap values over the T1. Mesh fragments
  behind the cap must never leak through; a slab/intersection overlay is separate from 3D voxels.
- Preserve the source NIfTI grid/affine (or a compact GPU sampling volume) when meshing uploads so an
  arbitrary oblique plane can be sampled accurately. Define nearest/linear interpolation and slab
  thickness in millimetres, and use the existing per-overlay threshold/colormap/priority rules.
