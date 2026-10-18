# BTDN BTD6-Reference Map Pack

## Map selections

The four earlier custom maps have been replaced with original, code-drawn playable homages to these **BTD6 maps**:

- **Monkey Meadow** — open green meadow, tree-lined corners and a long looping lane.
- **Town Center** — village buildings, grass plots and a winding town route.
- **Skates** — snow, ice banks and frozen-water scenery around a looping lane.
- **Resort** — beach sand, palms, umbrellas and a bright lagoon route.

No BTD6 image, texture, sprite, or extracted game asset is included. The visual interpretations, SVG thumbnails, and Canvas scenery are newly drawn for this project; the names and high-level map references identify the source maps.

## Visual and menu improvements

- The six-map selector is a centered three-column by two-row desktop grid.
- Card previews are larger, use crisp SVG artwork, and have depth, outlines and hover feedback.
- Tablet layouts use two columns; narrow phones use a single column without horizontal scrolling.
- The four playable Canvas maps now use cached, layered terrain scenes: directional lighting, slope-like gradients, soft object shadows, outlined foliage, dimensional rocks, water highlights, snow crystals, buildings, palms and themed ground detail.
- Tracks are rendered as three-layer, shadowed lanes with highlighted surfaces, clean borders, subtle texture marks and clear entrance/exit markers.
- Static terrain is pre-rendered into an offscreen Canvas and composited each frame, keeping the richer presentation lightweight.

## Compatibility

Every replacement map has Easy, Medium and Hard launch pages, a continuous entrance-to-exit waypoint path, terrain-aware tower placement, and water zones for naval towers. Existing towers, upgrades, waves, bloons, money, lives and difficulties are unchanged.

## Tests performed

- Verified JavaScript syntax for the shared map layer.
- Verified the upgraded renderer preserves the same map identifiers and waypoint arrays used by all difficulty launch pages.
- Verified the 12 replacement map/difficulty pages reference the correct map IDs.
- Verified all six menu-preview assets resolve.
- Verified Tree Trunk pages, asset and string references remain absent.
- Verified the ZIP contains four map sets (12 launch pages) and excludes Tree Trunk assets.

## Limitation

Static integration checks were performed. A graphical browser/Electron runtime was not provided, so a manual visual playthrough was not run here.
