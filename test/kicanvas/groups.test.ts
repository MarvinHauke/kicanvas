/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { assert } from "chai";

import { SymbolGroupSet, step_id } from "../../src/kicanvas/groups";
import { Project } from "../../src/kicanvas/project";
import { parse_refs } from "../../src/kicanvas/refs";
import { LocalFileSystem } from "../../src/kicanvas/services/vfs";
import amp_src from "../kicad/files/hier/amp.kicad_sch";
import root_src from "../kicad/files/hier/root.kicad_sch";

const example = {
    version: 1,
    title: "hier",
    source: "analysis",
    reviewed: false,
    selected: "amp#2",
    groups: [
        {
            id: "amp#1",
            label: "#1 amp",
            refs: ["R1", "U1.A"],
            kind: "amp",
            description: ["first note", "second note"],
            nets: ["GND"],
        },
        {
            id: "amp#2",
            refs: "R11 U11.B",
            kind: "amp",
            status: "ambiguous",
            color: "#e377c2",
        },
        { id: "part#1", refs: ["U1.B"], parent: "amp#1" },
        { id: "missing#1", refs: ["R100", "R999"] },
    ],
    parts: {
        R1: { kind: "resistor", value: "10k" },
        U1: { kind: "opamp" },
    },
};

async function load_project() {
    const project = new Project();
    await project.load(
        new LocalFileSystem([
            new File([root_src], "root.kicad_sch"),
            new File([amp_src], "amp.kicad_sch"),
        ]),
    );
    return project;
}

suite("kicanvas.groups", function () {
    test("parses all fields", function () {
        const set = SymbolGroupSet.parse(JSON.stringify(example));

        assert.equal(set.title, "hier");
        assert.equal(set.source, "analysis");
        assert.isFalse(set.reviewed);
        assert.equal(set.selected, "amp#2");
        assert.equal(set.groups.length, 4);

        const g1 = set.by_id("amp#1")!;
        assert.equal(g1.label, "#1 amp");
        assert.deepEqual(
            g1.refs.map((r) => r.text),
            ["R1", "U1.A"],
        );
        assert.equal(g1.refs[1]!.unit, 1);
        assert.equal(g1.description, "first note\nsecond note");
        assert.isUndefined(g1.status);

        const g2 = set.by_id("amp#2")!;
        assert.equal(g2.label, "amp#2", "label defaults to id");
        assert.equal(g2.status, "ambiguous");
        assert.equal(g2.color, "#e377c2");
        assert.deepEqual(
            g2.refs.map((r) => r.text),
            ["R11", "U11.B"],
            "refs may be a string",
        );

        assert.deepEqual(set.parts.get("R1"), {
            kind: "resistor",
            value: "10k",
        });
        assert.deepEqual(set.parts.get("U1"), {
            kind: "opamp",
            value: undefined,
        });
    });

    test("tree", function () {
        const set = SymbolGroupSet.parse(example);

        assert.deepEqual(
            set.top_level.map((g) => g.id),
            ["amp#1", "amp#2", "missing#1"],
        );
        assert.deepEqual(
            set.children("amp#1").map((g) => g.id),
            ["part#1"],
        );
        const with_symbol = (ref: string, unit?: number) =>
            set.groups_with_symbol(ref, unit).map((g) => g.id);

        assert.deepEqual(with_symbol("U1"), ["amp#1", "part#1"]);
        assert.deepEqual(with_symbol("U1", 1), ["amp#1"]);
        assert.deepEqual(with_symbol("U1", 2), ["part#1"]);
        assert.deepEqual(with_symbol("R1", 1), ["amp#1"]);
        assert.deepEqual(with_symbol("R2"), []);
    });

    test("skips invalid groups", function () {
        const set = SymbolGroupSet.parse({
            version: 1,
            selected: "nope",
            groups: [
                "not an object",
                { refs: ["R1"] },
                { id: "no-refs" },
                { id: "bad-refs", refs: [1, 2] },
                { id: "ok", refs: ["R1"], parent: "unknown" },
                { id: "ok", refs: ["R2"] },
            ],
        });

        assert.deepEqual(
            set.groups.map((g) => g.id),
            ["ok"],
        );
        assert.equal(set.by_id("ok")!.refs[0]!.text, "R1", "first one wins");
        assert.isUndefined(set.by_id("ok")!.parent, "unknown parent dropped");
        assert.isUndefined(set.selected, "unknown selection dropped");
    });

    test("breaks parent cycles", function () {
        const set = SymbolGroupSet.parse({
            version: 1,
            groups: [
                { id: "a", refs: ["R1"], parent: "b" },
                { id: "b", refs: ["R2"], parent: "a" },
                { id: "c", refs: ["R3"], parent: "c" },
            ],
        });

        // Every group is reachable from the top level.
        const reachable = new Set<string>();
        const walk = (id: string) => {
            reachable.add(id);
            set.children(id).forEach((g) => walk(g.id));
        };
        set.top_level.forEach((g) => walk(g.id));
        assert.deepEqual([...reachable].sort(), ["a", "b", "c"]);
    });

    test("rejects invalid documents", function () {
        assert.throws(() => SymbolGroupSet.parse("[]"));
        assert.throws(() => SymbolGroupSet.parse("{}"));
        assert.throws(() => SymbolGroupSet.parse("not json"));
    });

    test("resolves groups in a project", async function () {
        const project = await load_project();
        const set = SymbolGroupSet.parse(example);
        set.resolve(project);

        const sheets = (id: string) =>
            set.by_id(id)!.pages.map((p) => p.page.name);

        assert.deepEqual(sheets("amp#1"), ["amp_left"]);
        assert.deepEqual(sheets("amp#2"), ["amp_right"]);
        assert.deepEqual(sheets("missing#1"), ["Root"]);
        assert.deepEqual(set.by_id("missing#1")!.missing, ["R999"]);
        assert.deepEqual(set.by_id("amp#1")!.missing, []);
    });

    test("parts of a group", async function () {
        const project = await load_project();
        const set = SymbolGroupSet.parse(example);
        set.parts.set("U1.A", { kind: "opamp unit" });
        set.resolve(project);

        const parts = (id: string) =>
            set
                .parts_of(set.by_id(id)!)
                .map((p) => [p.query.text, p.kind, p.value, p.missing]);

        // "U1.A" has its own entry, "U1.B" falls back to "U1".
        assert.deepEqual(parts("amp#1"), [
            ["R1", "resistor", "10k", false],
            ["U1.A", "opamp unit", undefined, false],
        ]);
        assert.deepEqual(parts("part#1"), [
            ["U1.B", "opamp", undefined, false],
        ]);
        assert.deepEqual(parts("missing#1"), [
            ["R100", undefined, undefined, false],
            ["R999", undefined, undefined, true],
        ]);
    });

    test("selection", function () {
        const set = SymbolGroupSet.parse(example);
        const events: (string | null)[] = [];
        set.addEventListener(SymbolGroupSet.select_event, (e) => {
            events.push((e as CustomEvent).detail?.id ?? null);
        });

        assert.equal(set.selected, "amp#2");
        assert.equal(set.selected_group?.id, "amp#2");

        set.select("amp#1");
        set.select("amp#1"); // unchanged, no event
        set.select("unknown"); // clears the selection
        set.select(null); // unchanged, no event

        assert.deepEqual(events, ["amp#1", null]);
        assert.isUndefined(set.selected_group);
    });

    test("review", function () {
        const set = SymbolGroupSet.parse({
            version: 1,
            groups: [
                { id: "a", refs: ["R1"], review: "correct" },
                { id: "b", refs: ["R2"], review: "maybe" },
            ],
        });
        const events: string[] = [];
        set.addEventListener(SymbolGroupSet.review_event, (e) => {
            events.push((e as CustomEvent).detail.id);
        });

        assert.equal(set.by_id("a")!.review, "correct");
        assert.isUndefined(set.by_id("b")!.review);
        assert.isFalse(set.all_reviewed);

        set.set_review("b", "wrong");
        set.set_review("b", "wrong"); // unchanged, no event
        set.set_review("a", null);
        set.set_review("unknown", "correct"); // ignored

        assert.deepEqual(events, ["b", "a"]);
        assert.equal(set.by_id("b")!.review, "wrong");
        assert.isUndefined(set.by_id("a")!.review);
    });

    test("undo review", function () {
        const set = SymbolGroupSet.parse(example);
        set.set_review("amp#1", "correct");
        set.set_review("amp#1", "wrong");
        set.set_review("amp#2", "correct");

        assert.equal(set.undo_review()?.id, "amp#2");
        assert.isUndefined(set.by_id("amp#2")!.review);
        assert.equal(set.undo_review()?.id, "amp#1");
        assert.equal(set.by_id("amp#1")!.review, "correct");
        assert.equal(set.undo_review()?.id, "amp#1");
        assert.isUndefined(set.by_id("amp#1")!.review);
        assert.isUndefined(set.undo_review());
    });

    test("step_id", function () {
        const ids = ["a", "b", "c", "d"];
        assert.equal(step_id(ids, undefined, 1), "a");
        assert.equal(step_id(ids, undefined, -1), "d");
        assert.equal(step_id(ids, "b", 1), "c");
        assert.equal(step_id(ids, "d", 1), "a");
        assert.equal(step_id(ids, "a", -1), "d");
        assert.equal(step_id(ids, "unknown", 1), "a");

        const odd = (id: string) => id == "a" || id == "c";
        assert.equal(step_id(ids, "a", 1, odd), "c");
        assert.equal(step_id(ids, "c", 1, odd), "a");
        assert.equal(step_id(ids, "b", -1, odd), "a");
        assert.equal(
            step_id(ids, "a", 1, (id) => id == "a"),
            "a",
        );
        assert.isUndefined(step_id(ids, "a", 1, () => false));
        assert.isUndefined(step_id([], undefined, 1));
    });

    test("to_json keeps the document and updates reviews", function () {
        const set = SymbolGroupSet.parse(JSON.stringify(example));
        set.set_review("amp#1", "correct");

        let json = set.to_json() as any;
        assert.equal(json.title, "hier");
        assert.equal(json.selected, "amp#2");
        assert.isFalse(json.reviewed);
        assert.deepEqual(json.parts, example.parts);
        assert.deepEqual(json.groups[0], {
            ...example.groups[0],
            review: "correct",
        });
        assert.deepEqual(json.groups[1], example.groups[1]);

        for (const group of set.groups) {
            set.set_review(group.id, "wrong");
        }
        json = set.to_json();
        assert.isTrue(json.reviewed);
        assert.equal(json.groups[0].review, "wrong");

        // The set itself isn't changed by exporting.
        assert.isFalse(set.reviewed);
        assert.deepEqual(json.groups[0].nets, ["GND"]);
    });

    test("to_json of added groups", function () {
        const set = new SymbolGroupSet();
        set.title = "t";
        set.add({
            id: "g",
            refs: parse_refs("R1 U1.A"),
            label: "g",
            description: "one\ntwo",
            pages: [],
            missing: [],
        });
        set.set_review("g", "correct");

        assert.deepEqual(set.to_json(), {
            version: 1,
            title: "t",
            reviewed: true,
            groups: [
                {
                    id: "g",
                    refs: ["R1", "U1.A"],
                    description: ["one", "two"],
                    review: "correct",
                },
            ],
        });
    });

    test("add", function () {
        const set = new SymbolGroupSet();
        const group = {
            id: "g",
            refs: [],
            label: "g",
            pages: [],
            missing: [],
        };
        assert.isTrue(set.add(group));
        assert.isFalse(set.add({ ...group }));
        assert.equal(set.groups.length, 1);
    });
});
