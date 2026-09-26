# <kicanvas-embed\>: The KiCanvas embedded viewer element

<!-- load kicanvas -->

<script type="module" src="/kicanvas/kicanvas.js"></script>

!!! warning "Work in progress"

    KiCanvas is in **alpha**. This is a proposed API with an incomplete implementation. Everything here is subject to change and you should be cautious if using it on your own web page.

The `<kicanvas-embed>` HTML element embeds one or more KiCad documents onto the page:

```html
<kicanvas-embed src="my-schematic.kicad_sch"></kicanvas-embed>
```

<kicanvas-embed src="/examples/simple.kicad_sch"></kicanvas-embed>

The above example shows the most basic usage of the `<kicanvas-embed>` element. It's usage is intentionally similar to the [`<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video) and [`<img>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img) elements. Through the use of additional [attributes](#attributes) you can control how the document is displayed, control interactivity, and load multiple files.

!!! note

    This page's format is modeled after MDN's [HTML elements reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Element). It's intended to be familiar to web developers.

## Installation

During alpha, the best way to install KiCanvas is to [download the bundled kicanvas.js](/kicanvas/kicanvas.js), copy it into your project, and include it with a script tag:

```html
<script type="module" src="/kicanvas.js"></script>
```

## Examples

### Interactivity

This example embeds a single document and enables only basic controls- such as pan, zoom, select, & download:

```html
<kicanvas-embed src="my-schematic.kicad_sch" controls="basic"> </kicanvas-embed>
```

<kicanvas-embed src="/examples/simple.kicad_sch" controls="basic"></kicanvas-embed>

Using `controls="full"`, the viewer gains the sidebar and info panels:

```html
<kicanvas-embed src="my-schematic.kicad_sch" controls="full"> </kicanvas-embed>
```

<kicanvas-embed src="/examples/simple.kicad_sch" controls="full"></kicanvas-embed>

You can disable specific controls and panels using `controlslist`. This example hides the download button:

```html
<kicanvas-embed
    src="my-schematic.kicad_sch"
    controls="basic"
    controlslist="nodownload">
</kicanvas-embed>
```

<kicanvas-embed src="/examples/simple.kicad_sch" controls="basic" controlslist="nodownload"></kicanvas-embed>

### Deep linking

!!! warning "Not yet implemented"

    This functionality hasn't been implemented yet

This example shows that if you give the `<kicanvas-embed>` element an `id`, you can deep link into it using `#[id]:[reference]`:

```html
<kicanvas-embed id="my-schematic" src="my-schematic.kicad_sch" controls="basic">
</kicanvas-embed>

<a href="#my-schematic:Q101">Link to Q101</a>
```

### Multiple files

This example shows how to use `<kicanvas-source>` to load multiple files.

```html
<kicanvas-embed controls="full">
    <kicanvas-source src="project.kicad_prj"></kicanvas-source>
    <kicanvas-source src="schematic1.kicad_sch"></kicanvas-source>
    <kicanvas-source src="schematic2.kicad_sch"></kicanvas-source>
    <kicanvas-source src="board.kicad_pcb"></kicanvas-source>
</kicanvas-embed>
```

<kicanvas-embed controls="full">
    <kicanvas-source src="/examples/simple.kicad_sch"></kicanvas-source>
    <kicanvas-source src="/examples/starfish.kicad_pcb"></kicanvas-source>
</kicanvas-embed>

You can switch between the displayed files using the project panel on the right side. Note that if the files are all part of the same project, then the root schematic will be shown by default. If they are unrelated, the first schematic will be shown.

### Inline source

This example shows how to use `<kicanvas-source>` along with inline KiCad data. In this case, it's a symbol copied from a schematic and pasted into the HTML source:

```html
<kicanvas-embed>
    <!-- Use it directly -->
    <kicanvas-source>
        (kicad_sch (version 20230121) (generator eeschema) (uuid
        5d5ad125-5ef1-42a1-a410-a0c4ab262ca6) (paper "A4") (title_block (title
        "KiCanvas inline sources") (date "2023-11-11") ) (lib_symbols ) (text
        "Hello World !!!" (at 90 100 0) (effects (font (size 5 5) (thickness 1)
        bold) (justify left bottom)) (uuid 27eb63d7-7111-4c0e-9985-c1ed90138e31)
        ) (sheet_instances (path "/" (page "1")) ) )
    </kicanvas-source>

    <!-- Or mixed with `src` tag -->
    <kicanvas-source src="/examples/simple.kicad_sch"></kicanvas-source>
</kicanvas-embed>
```

<kicanvas-embed controls="full">
    <kicanvas-source src="/examples/simple.kicad_sch"></kicanvas-source>
    <kicanvas-source name="inline.kicad_sch">
        (kicad_sch (version 20230121) (generator eeschema) (uuid
        5d5ad125-5ef1-42a1-a410-a0c4ab262ca6) (paper "A4") (title_block (title
        "KiCanvas inline sources") (date "2023-11-11") ) (lib_symbols ) (text
        "Inline source file" (at 90 100 0) (effects (font (size 5 5) (thickness 1)
        bold) (justify left bottom)) (uuid 27eb63d7-7111-4c0e-9985-c1ed90138e31)
        ) (sheet_instances (path "/" (page "1")) ) )
    </kicanvas-source>
</kicanvas-embed>

### Highlighting symbols

Use `<kicanvas-highlight>` to mark groups of schematic symbols, for example the parts of a subcircuit. Each group is listed in the **Subcircuits** panel. Only the selected group is drawn: its symbols get transparent boxes (symbols within 2.54 mm of each other share a box), and separate boxes are linked by dashed lines. If the group's symbols are on several sheets, its label says how many are elsewhere, for example `+2 on amp_left`.

```html
<kicanvas-embed src="/examples/amplifier.kicad_sch" controls="full">
    <kicanvas-highlight
        refs="U1.A R1 R2"
        label="#1 buffer"
        group="buffer"
        title="unit A of U1 with its feedback resistors"
        selected></kicanvas-highlight>
    <kicanvas-highlight
        refs="C3 C4"
        group="decoupling"
        ambiguous></kicanvas-highlight>
</kicanvas-embed>
```

Attributes of `<kicanvas-highlight>`:

- `refs` - the references of the symbols, separated by spaces. `U1.A` names unit A of `U1`, `U1` names all its units. References are looked up on every sheet, including each instance of a sheet that's used more than once.
- `label` - the name shown in the panel and on the schematic. Defaults to `refs`.
- `group` - the kind of group. Groups of the same kind get the same color and are listed together.
- `color` - a CSS color that overrides the group color.
- `title` - a description, shown in the panel.
- `ambiguous` - draws a dashed outline, for groups that aren't certain.
- `selected` - selects this group when the viewer loads.

### Symbol groups and review

For many groups, such as the output of a circuit analysis tool, put them in a `<kicanvas-groups>` element as JSON, either inline or from a URL with `src`. The **Subcircuits** panel lists them and lets you review each one as correct or wrong.

```html
<kicanvas-embed controls="full">
    <kicanvas-source src="/examples/amplifier.kicad_sch"></kicanvas-source>
    <kicanvas-groups src="/examples/amplifier.groups.json"></kicanvas-groups>
</kicanvas-embed>
```

The JSON format, version 1:

```json
{
    "version": 1,
    "title": "amplifier",
    "source": "analysis",
    "reviewed": false,
    "selected": "inverting_amp#1",
    "kinds": ["inverting_amp", "voltage_divider", "schmitt_trigger"],
    "groups": [
        {
            "id": "inverting_amp#1",
            "refs": ["R42", "R43", "U1.A"],
            "kind": "inverting_amp",
            "description": ["negative feedback closed through R43"]
        },
        {
            "id": "voltage_divider#8",
            "refs": ["R7", "R8"],
            "kind": "voltage_divider",
            "parent": "inverting_amp#1",
            "status": "ambiguous",
            "review": "correct"
        }
    ],
    "parts": {
        "R42": { "kind": "resistor", "value": "10k" },
        "U1": { "kind": "opamp", "value": "TL072" }
    }
}
```

| Field                  | Required | Meaning                                                                                             |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `version`              | yes      | Always `1`.                                                                                         |
| `title`, `source`      |          | Shown at the top of the panel. `title` also names the exported file.                                |
| `reviewed`             |          | Whether the groups have been reviewed.                                                              |
| `selected`             |          | The id of the group selected when the viewer loads.                                                 |
| `kinds`                |          | All known group kinds, offered when typing the kind of a new group. Other kinds get a typo warning. |
| `groups[].id`          | yes      | A unique id.                                                                                        |
| `groups[].refs`        | yes      | The references of the symbols, as a list or a string, like in `<kicanvas-highlight>`.               |
| `groups[].label`       |          | The name shown, defaults to `id`.                                                                   |
| `groups[].kind`        |          | Groups of the same kind get the same color and are listed together.                                 |
| `groups[].status`      |          | `"ambiguous"` draws a dashed outline and a `?` in the list.                                         |
| `groups[].parent`      |          | The id of the group this one is part of. It's listed under its parent.                              |
| `groups[].description` |          | A string or a list of strings, shown in the details.                                                |
| `groups[].color`       |          | A CSS color that overrides the kind's color.                                                        |
| `groups[].review`      |          | `"correct"` or `"wrong"`, set by reviewing.                                                         |
| `groups[].added`       |          | `true` for groups a reviewer added, such as subcircuits an analysis missed.                         |
| `parts`                |          | The kind and value of each symbol by reference, shown in the details.                               |

Unknown fields are ignored, and kept when the reviews are exported.

The **Subcircuits** panel shows:

- the groups by kind, with nested groups under their parent, and marks: `✓` correct, `✗` wrong, `?` ambiguous, `!` references that weren't found.
- the details of the selected group: kind, status, description, the group it's part of and the groups it contains, and its parts with kind and value. Selecting a part selects its symbol, switching sheets if needed.
- the groups of the symbol selected in the schematic.
- the review progress, such as `3/29 reviewed`.

**Reviewing:** mark the selected group with **✓ Correct** or **✗ Wrong**. Selecting the same button again clears the review. The download button in the panel title exports the groups as `<title>.groups.json`. The file is the loaded JSON with only the `review` of each group changed, and `reviewed` is set to `true` once every group has a review. The browser asks before you leave the page with reviews that weren't exported.

**Adding groups:** for a subcircuit that's missing from the list, select one of its symbols and press `o` or the **+** button in the panel title. This creates a group named `new#1`, `new#2` and so on, marked as correct. Type its kind in the details (the field suggests known kinds, and `Tab` completes the best match), and the group is shown as `new#1 <kind>`. Then Shift-click (or Ctrl/Cmd-click) more symbols in the schematic to add them. Shift-clicking a symbol that's already in the group removes it. You can switch sheets while doing this, so a group can span sheets. For a group that's only partly right, mark it wrong and press `c` to make an editable copy to fix. Only groups created this way can be edited or deleted; loaded groups can only be reviewed. The export adds the new groups at the end, with `id`, `refs`, `kind`, `review` and `added: true`. Groups without symbols are left out.

**Kind suggestions:** while you add symbols to a new group, the details suggest kinds whose groups have the most similar parts. For example, two resistors suggest `voltage_divider`. The part kinds come from `parts`, or the reference prefix (`R`, `C`, `U`) if a part isn't listed. Click a suggestion to use it. If the document has a `kinds` list, a kind that isn't in it is shown with a warning, since it's likely a typo.

**Evaluation:** press `e` or the chart button in the panel title to see how well the tool that found the groups did, counted from the reviews. For each kind, a table shows the groups reviewed correct (true positives) and wrong (false positives), the groups added by a reviewer and marked correct (missed, false negatives), the groups not reviewed yet, and precision and recall. The panel shows the totals next to the review progress. Only top-level groups are counted, since nested groups are covered by their parent. Recall is only final once every group is reviewed and the missing ones are added. The table updates while you review.

**Keyboard shortcuts** work while the Subcircuits panel is open. They're vim style: press `?` to see them all. When you start a shortcut with several keys, such as `z`, a popup shows how it can go on.

| Keys       | Action                                     |
| ---------- | ------------------------------------------ |
| `j` / `k`  | next / previous group                      |
| `gg` / `G` | first / last group                         |
| `n` / `N`  | next / previous group without a review     |
| `y` / `x`  | mark correct / wrong, again to clear       |
| `u`        | undo the last review                       |
| `:w`       | export the reviews                         |
| `e`        | show or hide the evaluation table          |
| `o`        | new group from the selected symbol         |
| `c`        | copy the selected group as a new group     |
| `dd`       | delete the selected new group              |
| `zz`       | zoom to the selected group                 |
| `zs`       | zoom to the selected symbol                |
| `zp`       | zoom to the page                           |
| `+` / `-`  | zoom in / out                              |
| `/`        | search the groups, `Esc` leaves the search |
| `Esc`      | close the popup, or clear the selection    |
| `?`        | show all shortcuts                         |

`j`, `k` and `n` only go through the groups the search lets through. On a page with several viewers, the shortcuts go to the one that was clicked last.

From JavaScript, the groups are available as `groups` on the `<kicanvas-embed>` element:

```js
const embed = document.querySelector("kicanvas-embed");
embed.groups.select("inverting_amp#1"); // or null to clear the selection
embed.groups.set_review("inverting_amp#1", "correct");
embed.groups.create_group(); // an empty, editable "new#n" group
const json = embed.groups.to_json();
```

## Attributes

!!! warning "Not yet implemented"

    Attributes marked with a ⚠️ are either not yet implemented or not completely implemented.

- `controls` - determines if the document is interactive (pan, zoom, etc.) and which controls are available.
    - `none` - document is not interactive and behaves like an `<img>` (default)
    - `basic` - zoom, pan, and select are available.
    - `full` - complete interactive viewer, including side panels.
- `controlslist` - further customizes the available controls.
    - `nooverlay` - don't show the "click or tap to interact" overlay.
    - `nofullscreen` - don't show the fullscreen button. ⚠️
    - `nodownload` - don't show the download button.
    - `download` - show the download button when used with controls="none".
    - `noflipview` - don't show the flip board button.
    - `flipview` - show the flip board button when used with controls="none".
    - `nosymbols` - don't show the schematic symbols panel. ⚠️
    - `nofootprints` - don't show the board footprints panel. ⚠️
    - `noobjects` - don't show the board objects panel. ⚠️
    - `noproperties` - don't show the selection properties panel. ⚠️
    - `noinfo` - don't show the document info panel. ⚠️
    - `nopreferences` - don't show the user preferences panel. ⚠️
    - `nohelp` - don't show the help panel. ⚠️
- `src` - the URL of the document to embed. If you want to show multiple documents within a single viewer, you can use multiple child `<kicanvas-source>` elements.
- `type` - when providing the file source inline, this explicitly sets the file type. If not specified, KiCanvas will attempt to determine the type automatically. If specified, it should be one of `schematic`, `board`, `project`, or `worksheet`.
- `name` - when providing the file source inline, this explicitly sets the file name. This is typically only necessary when there are multiple files within a project, as KiCad uses the file name to link schematic sheets, drawing sheets, and PCBs together. If unspecified, KiCanvas will generate a file name like `inline_0.kicad_sch`.
- `theme` - sets the color theme to use, valid values are `kicad` and `witchhazel`. ⚠️
- `zoom` - sets the initial view into the document. ⚠️
    - `objects` - zooms to show all visible objects (default). ⚠️
    - `page` - zooms to show the entire page. ⚠️
    - `x y w h` - zooms to the given area, similar to the SVG `viewBox` attribute. For example, `10 10 100 100`. ⚠️
    - `<list of references>` - zooms to include the given symbols or footprints. For example `C101 D101 Q101`. ⚠️

## Events

!!! warning "Not yet implemented"

    This functionality hasn't been implemented yet

| Event Name                  | Fired When                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| ⚠️`kicanvas:click`          | The user clicks or taps within the embedded document                                              |
| ⚠️`kicanvas:documentchange` | The currently displayed document is changed, either through user interaction or programmatically. |
| ⚠️`kicanvas:error`          | An error occurs while loading source files                                                        |
| ⚠️`kicanvas:load`           | All sources files have been successfully loaded                                                   |
| ⚠️`kicanvas:loadstart`      | KiCanvas begins loading source files                                                              |
| ⚠️`kicanvas:select`         | The user selects (or deselects) an object within the document                                     |
