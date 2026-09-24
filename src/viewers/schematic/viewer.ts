/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { first } from "../../base/iterator";
import { BBox } from "../../base/math";
import { is_string } from "../../base/types";
import { Renderer } from "../../graphics";
import { Canvas2DRenderer } from "../../graphics/canvas2d";
import type { SchematicTheme } from "../../kicad";
import {
    KicadSch,
    SchematicSheet,
    SchematicSymbol,
} from "../../kicad/schematic";
import type { ProjectPage } from "../../kicanvas/project";
import { ref_matches, type RefQuery } from "../../kicanvas/refs";
import { DocumentViewer } from "../base/document-viewer";
import type { HighlightGroup } from "../base/highlights";
import { LayerSet } from "./layers";
import { SchematicPainter } from "./painter";

export class SchematicViewer extends DocumentViewer<
    KicadSch,
    SchematicPainter,
    LayerSet,
    SchematicTheme
> {
    get schematic(): KicadSch {
        return this.document;
    }

    /** Project path of the page being shown, if loaded from a project. */
    #page_path: string | null = null;

    override create_renderer(canvas: HTMLCanvasElement): Renderer {
        const renderer = new Canvas2DRenderer(canvas);
        renderer.state.fill = this.theme.note;
        renderer.state.stroke = this.theme.note;
        renderer.state.stroke_width = 0.1524;
        return renderer;
    }

    override async load(src: KicadSch | ProjectPage) {
        if (src instanceof KicadSch) {
            this.#page_path = null;
            return await super.load(src);
        }

        this.document = null!;
        this.#page_path = src.project_path;

        const doc = src.document as KicadSch;
        doc.update_hierarchical_data(src.sheet_path);

        return await super.load(doc);
    }

    protected override create_painter() {
        return new SchematicPainter(this.renderer, this.layers, this.theme);
    }

    protected override create_layer_set() {
        return new LayerSet(this.theme);
    }

    protected override find_refs_bboxes(refs: RefQuery[]): BBox[] {
        const bboxes: BBox[] = [];

        // Nothing to find while a page is being loaded.
        if (!this.schematic) {
            return bboxes;
        }

        // Symbol references and units have already been updated for the
        // sheet instance being shown by load().
        for (const symbol of this.schematic.symbols.values()) {
            if (
                refs.some((q) => ref_matches(q, symbol.reference, symbol.unit))
            ) {
                bboxes.push(...this.layers.query_item_bboxes(symbol));
            }
        }

        return bboxes;
    }

    protected override highlight_label(group: HighlightGroup): string {
        const elsewhere = (group.pages ?? []).filter(
            (p) => p.path != this.#page_path,
        );

        if (!this.#page_path || !elsewhere.length) {
            return group.label;
        }

        const notes = elsewhere.map((p) => `+${p.count} on ${p.name}`);
        return `${group.label} (${notes.join(", ")})`;
    }

    public override select(
        item: SchematicSymbol | SchematicSheet | string | BBox | null,
    ): void {
        // If item is a string, find the symbol by uuid or reference.
        if (is_string(item)) {
            item =
                this.schematic.find_symbol(item) ??
                this.schematic.find_sheet(item);
        }

        // If it's a symbol or sheet, find the bounding box for it.
        if (item instanceof SchematicSymbol || item instanceof SchematicSheet) {
            const bboxes = this.layers.query_item_bboxes(item);
            item = first(bboxes) ?? null;
        }

        super.select(item);
    }
}
