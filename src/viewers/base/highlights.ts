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
 * A group of items to highlight. Items that are close together share a box,
 * separate boxes are linked by dashed lines, and the label is drawn once.
 */
export interface HighlightGroup {
    refs: RefQuery[];
    label: string;
    color: Color;
    /** Draws a dashed outline, to mark groups that need a decision. */
    ambiguous: boolean;
    /** Pages with items of this group, used to note items on other pages. */
    pages?: { path: string; name: string; count: number }[];
}

// Sizes in schematic units (mm).
/** Items closer than this share a box. */
const cluster_gap = 2.54;
const margin = 1.27;
const outline_width = 0.3;
const link_width = 0.2;
const fill_alpha = 0.15;
const outline_dash = [2, 1] as const;
const link_dash = [0.8, 0.8] as const;
const label_size = 1.5;

/**
 * Draws a highlight group given the bounding boxes of its items on the
 * current page.
 */
export function paint_highlight(
    gfx: Renderer,
    item_bboxes: BBox[],
    group: HighlightGroup,
    label: string,
) {
    const boxes = cluster_boxes(item_bboxes, cluster_gap).map((bb) =>
        bb.grow(margin),
    );

    for (const [a, b] of spanning_links(boxes)) {
        const start = edge_point(a, b.center);
        const end = edge_point(b, a.center);
        for (const dash of dashes([start, end], ...link_dash)) {
            gfx.line(dash, link_width, group.color);
        }
    }

    for (const bb of boxes) {
        const outline = [
            bb.top_left,
            bb.top_right,
            bb.bottom_right,
            bb.bottom_left,
            bb.top_left,
        ];

        gfx.polygon(Polygon.from_BBox(bb, group.color.with_alpha(fill_alpha)));

        if (group.ambiguous) {
            for (const dash of dashes(outline, ...outline_dash)) {
                gfx.line(dash, outline_width, group.color);
            }
        } else {
            gfx.line(outline, outline_width, group.color);
        }
    }

    if (label && boxes.length) {
        paint_label(gfx, label, label_anchor(boxes), group.color);
    }
}

function paint_label(gfx: Renderer, text: string, box: BBox, color: Color) {
    // Text is laid out in KiCad's internal units (1/10000 mm).
    const attributes = new TextAttributes();
    attributes.size = new Vec2(label_size, label_size).multiply(10000);
    attributes.stroke_width = (label_size / 6) * 10000;
    attributes.h_align = "left";
    attributes.v_align = "bottom";
    attributes.color = color;

    gfx.state.push();
    gfx.state.stroke = color;
    gfx.state.fill = color;
    StrokeFont.default().draw(
        gfx,
        text,
        box.top_left.add(new Vec2(0, -outline_width * 2)).multiply(10000),
        attributes,
    );
    gfx.state.pop();
}

/** True if two boxes overlap or are closer than gap. */
export function boxes_near(a: BBox, b: BBox, gap: number) {
    return (
        a.x - gap <= b.x2 &&
        b.x - gap <= a.x2 &&
        a.y - gap <= b.y2 &&
        b.y - gap <= a.y2
    );
}

/**
 * Merges boxes that are closer than gap into combined boxes, repeating
 * until no two boxes are close, since merging can bring boxes together.
 */
export function cluster_boxes(boxes: BBox[], gap: number): BBox[] {
    let clusters = boxes.filter((b) => b.valid).map((b) => b.copy());
    let merged = true;

    while (merged) {
        merged = false;
        const result: BBox[] = [];

        for (const box of clusters) {
            const near = result.findIndex((r) => boxes_near(r, box, gap));
            if (near >= 0) {
                result[near] = BBox.combine([result[near]!, box]);
                merged = true;
            } else {
                result.push(box);
            }
        }

        clusters = result;
    }

    return clusters;
}

/**
 * Links boxes with as few, and as short, links as possible: a minimum
 * spanning tree over the box centers (Prim's algorithm).
 */
export function spanning_links(boxes: BBox[]): [BBox, BBox][] {
    const links: [BBox, BBox][] = [];

    if (boxes.length < 2) {
        return links;
    }

    const connected = [boxes[0]!];
    const remaining = boxes.slice(1);

    while (remaining.length) {
        let best: [number, BBox, number] | null = null;

        for (const a of connected) {
            for (const [i, b] of remaining.entries()) {
                const d = b.center.sub(a.center).magnitude;
                if (!best || d < best[0]) {
                    best = [d, a, i];
                }
            }
        }

        const [, from, index] = best!;
        const to = remaining.splice(index, 1)[0]!;
        links.push([from, to]);
        connected.push(to);
    }

    return links;
}

/**
 * The point where a line from the center of box towards target leaves the
 * box, so that links start at the box outline rather than its center.
 */
export function edge_point(box: BBox, target: Vec2): Vec2 {
    const center = box.center;
    const d = target.sub(center);

    if (d.x == 0 && d.y == 0) {
        return center;
    }

    const tx = d.x == 0 ? Infinity : box.w / 2 / Math.abs(d.x);
    const ty = d.y == 0 ? Infinity : box.h / 2 / Math.abs(d.y);
    const t = Math.min(tx, ty, 1);

    return center.add(d.multiply(t));
}

/** The box the label goes above: the one closest to the top left. */
export function label_anchor(boxes: BBox[]): BBox {
    return boxes.reduce((best, b) => (b.x + b.y < best.x + best.y ? b : best));
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
