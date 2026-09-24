/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { assert } from "chai";

import { KicadSch } from "../../src/kicad/schematic";
import { Project } from "../../src/kicanvas/project";
import {
    parse_refs,
    parse_view,
    resolve_refs,
    unit_from_suffix,
    type ResolvedRefs,
} from "../../src/kicanvas/refs";
import { LocalFileSystem } from "../../src/kicanvas/services/vfs";
import amp_src from "../kicad/files/hier/amp.kicad_sch";
import root_src from "../kicad/files/hier/root.kicad_sch";

const LEFT =
    "amp.kicad_sch:/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000000b";
const RIGHT =
    "amp.kicad_sch:/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000000c";

async function load_project() {
    const fs = new LocalFileSystem([
        new File([root_src], "root.kicad_sch"),
        new File([amp_src], "amp.kicad_sch"),
    ]);
    const project = new Project();
    await project.load(fs);
    return project;
}

/** Summarizes a result as {page project_path: [symbol uuid suffix]} */
function summarize(result: ResolvedRefs) {
    const out: Record<string, string[]> = {};
    for (const { page, symbols } of result.pages) {
        out[page.project_path] = symbols.map((s) => s.uuid.slice(-3));
    }
    return out;
}

suite("kicanvas.refs", function () {
    test("unit_from_suffix", function () {
        assert.equal(unit_from_suffix("A"), 1);
        assert.equal(unit_from_suffix("b"), 2);
        assert.equal(unit_from_suffix("Z"), 26);
        assert.equal(unit_from_suffix("AA"), 27);
    });

    test("parse_refs", function () {
        assert.deepEqual(parse_refs("R1  U2.A,C3.bb"), [
            { text: "R1", ref: "R1" },
            { text: "U2.A", ref: "U2", unit: 1 },
            { text: "C3.bb", ref: "C3", unit: 54 },
        ]);
        assert.deepEqual(parse_refs(""), []);
        assert.deepEqual(parse_refs("  , "), []);
        // A suffix that isn't all letters is part of the reference.
        assert.deepEqual(parse_refs("U2.1"), [{ text: "U2.1", ref: "U2.1" }]);
    });

    test("parse_view", function () {
        assert.deepEqual(parse_view(null), { kind: "page" });
        assert.deepEqual(parse_view(" page "), { kind: "page" });
        assert.deepEqual(parse_view("objects"), { kind: "objects" });

        const area = parse_view("10 20.5 30 40");
        assert.equal(area.kind, "area");
        if (area.kind == "area") {
            assert.deepEqual(
                [area.bbox.x, area.bbox.y, area.bbox.w, area.bbox.h],
                [10, 20.5, 30, 40],
            );
        }

        assert.deepEqual(parse_view("R1 U2.B"), {
            kind: "refs",
            refs: [
                { text: "R1", ref: "R1" },
                { text: "U2.B", ref: "U2", unit: 2 },
            ],
        });
        // Not four numbers, so these are references.
        assert.equal(parse_view("1 2 3").kind, "refs");
    });

    test("resolves references per sheet instance", async function () {
        const project = await load_project();

        const result = resolve_refs(project, "R1 R11 R100");
        assert.deepEqual(result.missing, []);
        assert.deepEqual(summarize(result), {
            "root.kicad_sch:/00000000-0000-0000-0000-00000000000a": ["100"],
            [LEFT]: ["001"],
            [RIGHT]: ["001"],
        });
    });

    test("doesn't depend on the page being shown", async function () {
        const project = await load_project();
        const amp = project.file_by_name("amp.kicad_sch") as KicadSch;

        // Simulate showing the right-hand instance, which rewrites the
        // shared document's references to R11/U11.
        amp.update_hierarchical_data(RIGHT.split(":")[1]);
        assert.equal(amp.symbols.values().next().value!.reference, "R11");

        assert.deepEqual(summarize(resolve_refs(project, "R1")), {
            [LEFT]: ["001"],
        });
    });

    test("matches units", async function () {
        const project = await load_project();

        assert.deepEqual(summarize(resolve_refs(project, "U1")), {
            [LEFT]: ["002", "003"],
        });
        assert.deepEqual(summarize(resolve_refs(project, "U11.B")), {
            [RIGHT]: ["003"],
        });
        assert.deepEqual(resolve_refs(project, "U1.C").missing, ["U1.C"]);
    });

    test("reports missing references", async function () {
        const project = await load_project();

        const result = resolve_refs(project, "R1 R999 U1.A");
        assert.deepEqual(result.missing, ["R999"]);
        assert.deepEqual(summarize(result), { [LEFT]: ["001", "002"] });
    });
});
