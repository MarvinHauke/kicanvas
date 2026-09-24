/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { assert } from "chai";

import { Color } from "../../src/base/color";
import { BBox, Vec2 } from "../../src/base/math";
import {
    group_color,
    highlight_palette,
    parse_flag,
} from "../../src/kicanvas/highlights";
import {
    cluster_boxes,
    dashes,
    edge_point,
    label_anchor,
    spanning_links,
} from "../../src/viewers/base/highlights";

const box = (x: number, y: number, w = 2, h = 2) => new BBox(x, y, w, h);
const coords = (b: BBox) => [b.x, b.y, b.w, b.h];

suite("kicanvas.highlights", function () {
    test("group_color is stable and from the palette", function () {
        const a = group_color("voltage_divider");
        const b = group_color("voltage_divider");
        assert.deepEqual(a, b);

        const palette_css = highlight_palette.map((c) =>
            Color.from_css(c).to_css(),
        );
        for (const name of ["push_pull", "inverting_amp", "", "x"]) {
            assert.include(palette_css, group_color(name).to_css());
        }

        // Different names should spread over several colors.
        const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
        const colors = new Set(names.map((n) => group_color(n).to_css()));
        assert.isAbove(colors.size, 3);
    });

    test("parse_flag", function () {
        assert.isFalse(parse_flag(null));
        assert.isFalse(parse_flag("false"));
        assert.isFalse(parse_flag(" FALSE "));
        assert.isTrue(parse_flag(""));
        assert.isTrue(parse_flag("true"));
        assert.isTrue(parse_flag("ambiguous"));
    });

    test("dashes", function () {
        const segments = dashes([new Vec2(0, 0), new Vec2(10, 0)], 2, 1);

        // 0-2, 3-5, 6-8, 9-10
        assert.equal(segments.length, 4);
        assert.deepEqual(
            segments.map(([a, b]) => [a!.x, b!.x]),
            [
                [0, 2],
                [3, 5],
                [6, 8],
                [9, 10],
            ],
        );

        // Zero-length edges are skipped.
        assert.equal(dashes([new Vec2(1, 1), new Vec2(1, 1)], 2, 1).length, 0);
    });

    test("cluster_boxes merges nearby boxes", function () {
        // a and b are 1 apart, c is far away.
        const clusters = cluster_boxes(
            [box(0, 0), box(3, 0), box(50, 50)],
            2.54,
        );
        assert.deepEqual(clusters.map(coords), [
            [0, 0, 5, 2],
            [50, 50, 2, 2],
        ]);

        // Merging a and c brings the combined box close to b.
        const chained = cluster_boxes(
            [box(0, 0), box(20, 0), box(0, 4, 20, 2)],
            2.54,
        );
        assert.equal(chained.length, 1);
        assert.deepEqual(coords(chained[0]!), [0, 0, 22, 6]);

        assert.deepEqual(cluster_boxes([], 2.54), []);
    });

    test("spanning_links connects all boxes with the shortest links", function () {
        const a = box(0, 0);
        const b = box(10, 0);
        const c = box(100, 0);
        const d = box(10, 20);

        const links = spanning_links([a, b, c, d]);
        assert.equal(links.length, 3);
        assert.deepEqual(
            links.map(([x, y]) => [x.x, y.x, y.y]),
            [
                [0, 10, 0], // a - b
                [10, 10, 20], // b - d
                [10, 100, 0], // b - c
            ],
        );

        assert.deepEqual(spanning_links([a]), []);
    });

    test("edge_point", function () {
        const b = new BBox(0, 0, 10, 4);
        assert.deepEqual(edge_point(b, new Vec2(20, 2)), new Vec2(10, 2));
        assert.deepEqual(edge_point(b, new Vec2(5, -10)), new Vec2(5, 0));
        // A target inside the box is returned as is.
        assert.deepEqual(edge_point(b, new Vec2(6, 2)), new Vec2(6, 2));
    });

    test("label_anchor picks the top left box", function () {
        const boxes = [box(50, 0), box(0, 30), box(10, 10)];
        assert.equal(label_anchor(boxes), boxes[2]);
    });
});
