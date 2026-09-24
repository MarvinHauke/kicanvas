/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { assert } from "chai";

import { Color } from "../../src/base/color";
import { Vec2 } from "../../src/base/math";
import {
    group_color,
    highlight_palette,
    parse_flag,
} from "../../src/kicanvas/highlights";
import { dashes } from "../../src/viewers/base/highlights";

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
});
