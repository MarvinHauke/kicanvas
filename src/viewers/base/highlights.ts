/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { BBox, Vec2 } from "../../base/math";
import { Color, Polygon, Renderer } from "../../graphics";
import { StrokeFont, TextAttributes } from "../../kicad/text";
import type { RefQuery } from "../../kicanvas/refs";

/**
 * A group of items to highlight, drawn as a colored box around the items with
 * a label above it.
 */
export interface HighlightGroup {
    refs: RefQuery[];
    label: string;
    color: Color;
    /** Draws a dashed outline, to mark groups that need a decision. */
    ambiguous: boolean;
}

// Sizes in schematic units (mm).
const margin = 1.27;
const outline_width = 0.3;
const fill_alpha = 0.12;
const dash_length = 2;
const gap_length = 1;
const label_size = 1.5;

/**
 * Draws a highlight group around the given bounding box of its items.
 */
export function paint_highlight(
    gfx: Renderer,
    items_bbox: BBox,
    group: HighlightGroup,
) {
    const bb = items_bbox.grow(margin);
    const outline = [
        bb.top_left,
        bb.top_right,
        bb.bottom_right,
        bb.bottom_left,
        bb.top_left,
    ];

    gfx.polygon(Polygon.from_BBox(bb, group.color.with_alpha(fill_alpha)));

    if (group.ambiguous) {
        for (const dash of dashes(outline, dash_length, gap_length)) {
            gfx.line(dash, outline_width, group.color);
        }
    } else {
        gfx.line(outline, outline_width, group.color);
    }

    if (group.label) {
        // Text is laid out in KiCad's internal units (1/10000 mm).
        const attributes = new TextAttributes();
        attributes.size = new Vec2(label_size, label_size).multiply(10000);
        attributes.stroke_width = (label_size / 6) * 10000;
        attributes.h_align = "left";
        attributes.v_align = "bottom";
        attributes.color = group.color;

        gfx.state.push();
        gfx.state.stroke = group.color;
        gfx.state.fill = group.color;
        StrokeFont.default().draw(
            gfx,
            group.label,
            bb.top_left.add(new Vec2(0, -outline_width * 2)).multiply(10000),
            attributes,
        );
        gfx.state.pop();
    }
}

/**
 * Splits a polyline into dashes, the renderers can't draw dashed lines.
 */
export function dashes(points: Vec2[], dash: number, gap: number): Vec2[][] {
    const result: Vec2[][] = [];

    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i]!;
        const end = points[i + 1]!;
        const length = end.sub(start).magnitude;

        if (length == 0) {
            continue;
        }

        const direction = end.sub(start).multiply(1 / length);

        for (let pos = 0; pos < length; pos += dash + gap) {
            const dash_end = Math.min(pos + dash, length);
            result.push([
                start.add(direction.multiply(pos)),
                start.add(direction.multiply(dash_end)),
            ]);
        }
    }

    return result;
}
