/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { Logger } from "../base/log";
import type { Project } from "./project";
import {
    parse_refs,
    resolve_refs,
    type RefQuery,
    type ResolvedPage,
} from "./refs";

const log = new Logger("kicanvas:groups");

/**
 * Symbol groups: named groups of symbols, such as the subcircuits found by a
 * circuit analysis tool, that can be listed and highlighted.
 *
 * JSON format, version 1:
 *
 *  {
 *    "version": 1,
 *    "title": "output_mixer",          // optional
 *    "source": "analysis",             // optional, free text
 *    "reviewed": false,                // optional
 *    "selected": "inverting_amp#1",    // optional, group selected at load
 *    "groups": [{
 *      "id": "inverting_amp#1",        // required, unique
 *      "refs": ["R42", "R43", "U1.A"], // required, REF or REF.UNIT (A = 1)
 *      "label": "#1 inverting_amp",    // optional, defaults to id
 *      "kind": "inverting_amp",        // optional, same kind = same color
 *      "status": "ambiguous",          // optional
 *      "parent": "push_pull#1",        // optional, id of the parent group
 *      "description": "...",           // optional, string or list of strings
 *      "color": "#e377c2",             // optional, CSS color
 *      "review": "correct"             // optional, "correct" or "wrong"
 *    }],
 *    "parts": {                        // optional, info about symbols
 *      "C2": { "kind": "capacitor_polarized", "value": "47uF" }
 *    }
 *  }
 *
 * Unknown fields are ignored, and kept by SymbolGroupSet.to_json().
 */

/** A reviewer's verdict on a group. */
export type Review = "correct" | "wrong";

export interface SymbolGroup {
    id: string;
    refs: RefQuery[];
    label: string;
    kind?: string;
    status?: string;
    parent?: string;
    description?: string;
    color?: string;
    review?: Review;
    /** Pages with symbols of this group, set by SymbolGroupSet.resolve(). */
    pages: ResolvedPage[];
    /** References that weren't found, set by SymbolGroupSet.resolve(). */
    missing: string[];
}

export interface PartInfo {
    kind?: string;
    value?: string;
}

/** A reference of a group together with what is known about its part. */
export interface GroupPart {
    query: RefQuery;
    kind?: string;
    value?: string;
    /** True if the reference wasn't found, set by SymbolGroupSet.resolve(). */
    missing: boolean;
}

export class SymbolGroupSet extends EventTarget {
    /** Fired when the selected group changes, detail is the group or null. */
    static readonly select_event = "kicanvas:groups:select";

    /** Fired when a group's review changes, detail is the group. */
    static readonly review_event = "kicanvas:groups:review";

    title?: string;
    source?: string;
    reviewed?: boolean;
    groups: SymbolGroup[] = [];
    parts: Map<string, PartInfo> = new Map();

    #by_id: Map<string, SymbolGroup> = new Map();
    #selected?: string;

    /** The parsed document and its groups, kept for to_json(). */
    #source?: Record<string, unknown>;
    #source_groups: Map<string, Record<string, unknown>> = new Map();

    /**
     * Parses symbol groups from JSON text or an already parsed object.
     * Invalid groups are skipped with a warning, an invalid document throws.
     */
    static parse(json: string | unknown): SymbolGroupSet {
        const data: unknown =
            typeof json === "string" ? JSON.parse(json) : json;

        if (!is_object(data)) {
            throw new Error("Symbol groups must be a JSON object");
        }

        if (data["version"] !== 1) {
            log.warn(
                `Unknown symbol groups version ${data["version"]}, expected 1`,
            );
        }

        if (!Array.isArray(data["groups"])) {
            throw new Error(`Symbol groups need a "groups" list`);
        }

        const set = new SymbolGroupSet();
        set.#source = structuredClone(data);
        set.title = opt_string(data["title"]);
        set.source = opt_string(data["source"]);
        set.reviewed =
            typeof data["reviewed"] === "boolean"
                ? data["reviewed"]
                : undefined;
        const selected = opt_string(data["selected"]);

        for (const [index, item] of data["groups"].entries()) {
            const group = parse_group(item, index);
            if (!group) {
                continue;
            }
            if (set.add(group)) {
                set.#source_groups.set(
                    group.id,
                    structuredClone(item as Record<string, unknown>),
                );
            }
        }

        for (const group of set.groups) {
            if (group.parent !== undefined && !set.#by_id.has(group.parent)) {
                log.warn(
                    `Symbol group "${group.id}" has unknown parent "${group.parent}"`,
                );
                group.parent = undefined;
            }
        }

        // Break parent cycles, otherwise the groups in a cycle would never
        // be reachable from the top level.
        for (const group of set.groups) {
            const seen = new Set([group.id]);
            let parent = group.parent;
            while (parent !== undefined) {
                if (seen.has(parent)) {
                    log.warn(
                        `Symbol group "${group.id}" is its own ancestor, parent removed`,
                    );
                    group.parent = undefined;
                    break;
                }
                seen.add(parent);
                parent = set.#by_id.get(parent)?.parent;
            }
        }

        set.select(selected);

        if (is_object(data["parts"])) {
            for (const [ref, info] of Object.entries(data["parts"])) {
                if (is_object(info)) {
                    set.parts.set(ref, {
                        kind: opt_string(info["kind"]),
                        value: opt_string(info["value"]),
                    });
                }
            }
        }

        return set;
    }

    /**
     * Adds a group, unless a group with the same id exists.
     * @returns true if the group was added.
     */
    add(group: SymbolGroup): boolean {
        if (this.#by_id.has(group.id)) {
            log.warn(`Duplicate symbol group id "${group.id}", skipped`);
            return false;
        }
        this.groups.push(group);
        this.#by_id.set(group.id, group);
        return true;
    }

    /** Id of the selected group. */
    get selected(): string | undefined {
        return this.#selected;
    }

    get selected_group(): SymbolGroup | undefined {
        return this.#selected === undefined
            ? undefined
            : this.#by_id.get(this.#selected);
    }

    /**
     * Selects a group by id, or clears the selection. Only one group can be
     * selected at a time.
     */
    select(id: string | null | undefined) {
        let next: string | undefined = undefined;

        if (id !== null && id !== undefined) {
            if (this.#by_id.has(id)) {
                next = id;
            } else {
                log.warn(`Symbol group "${id}" doesn't exist`);
            }
        }

        if (next === this.#selected) {
            return;
        }

        this.#selected = next;
        this.dispatchEvent(
            new CustomEvent(SymbolGroupSet.select_event, {
                detail: this.selected_group ?? null,
            }),
        );
    }

    /** Sets or clears the review of a group. */
    set_review(id: string, review: Review | null) {
        const group = this.#by_id.get(id);
        if (!group || group.review === (review ?? undefined)) {
            return;
        }

        group.review = review ?? undefined;
        this.dispatchEvent(
            new CustomEvent(SymbolGroupSet.review_event, { detail: group }),
        );
    }

    /** True if every group has a review. */
    get all_reviewed(): boolean {
        return this.groups.every((g) => g.review !== undefined);
    }

    /**
     * The groups as a JSON v1 object, for exporting reviews. Parsed groups
     * are written as they were read, including unknown fields, with only
     * their review updated. Invalid groups are left out. The document is
     * marked as reviewed once every group has a review.
     */
    to_json(): Record<string, unknown> {
        const data: Record<string, unknown> = this.#source
            ? structuredClone(this.#source)
            : omit_undefined({
                  version: 1,
                  title: this.title,
                  source: this.source,
                  reviewed: this.reviewed,
                  parts: this.parts.size
                      ? Object.fromEntries(this.parts)
                      : undefined,
              });

        data["groups"] = this.groups.map((group) => {
            const item = structuredClone(
                this.#source_groups.get(group.id) ?? group_to_json(group),
            );
            if (group.review) {
                item["review"] = group.review;
            } else {
                delete item["review"];
            }
            return item;
        });

        if (this.groups.length && this.all_reviewed) {
            data["reviewed"] = true;
        }

        return data;
    }

    by_id(id: string): SymbolGroup | undefined {
        return this.#by_id.get(id);
    }

    /** Groups without a parent, in file order. */
    get top_level(): SymbolGroup[] {
        return this.groups.filter((g) => g.parent === undefined);
    }

    /** Direct children of a group, in file order. */
    children(id: string): SymbolGroup[] {
        return this.groups.filter((g) => g.parent === id);
    }

    /**
     * Groups that contain the symbol with the given reference and unit. If
     * unit is undefined, groups with any unit of the symbol are included.
     */
    groups_with_symbol(reference: string, unit?: number): SymbolGroup[] {
        return this.groups.filter((g) =>
            g.refs.some(
                (q) =>
                    q.ref === reference &&
                    (unit === undefined ||
                        q.unit === undefined ||
                        q.unit === unit),
            ),
        );
    }

    /**
     * The references of a group in file order, with kind and value from
     * parts. Parts are looked up by the reference as written ("U1.A") and
     * then by the symbol's reference ("U1").
     */
    parts_of(group: SymbolGroup): GroupPart[] {
        return group.refs.map((query) => {
            const info =
                this.parts.get(query.text) ?? this.parts.get(query.ref);
            return {
                query,
                kind: info?.kind,
                value: info?.value,
                missing: group.missing.includes(query.text),
            };
        });
    }

    /**
     * Finds the symbols of every group in the project, filling in each
     * group's pages and missing references.
     */
    resolve(project: Project) {
        for (const group of this.groups) {
            const { pages, missing } = resolve_refs(project, group.refs);
            group.pages = pages;
            group.missing = missing;

            if (missing.length) {
                log.warn(
                    `Symbol group "${group.id}": references not found: ${missing.join(" ")}`,
                );
            }
        }
    }
}

function parse_group(item: unknown, index: number): SymbolGroup | null {
    const where = `Symbol group #${index + 1}`;

    if (!is_object(item)) {
        log.warn(`${where} isn't an object, skipped`);
        return null;
    }

    const id = opt_string(item["id"]);
    if (!id) {
        log.warn(`${where} has no "id", skipped`);
        return null;
    }

    const refs_value = item["refs"];
    let refs: RefQuery[] = [];
    if (typeof refs_value === "string") {
        refs = parse_refs(refs_value);
    } else if (
        Array.isArray(refs_value) &&
        refs_value.every((r) => typeof r === "string")
    ) {
        refs = parse_refs(refs_value.join(" "));
    }

    if (!refs.length) {
        log.warn(`Symbol group "${id}" has no "refs", skipped`);
        return null;
    }

    let description = item["description"];
    if (Array.isArray(description)) {
        description = description
            .filter((d) => typeof d === "string")
            .join("\n");
    }

    return {
        id,
        refs,
        label: opt_string(item["label"]) ?? id,
        kind: opt_string(item["kind"]),
        status: opt_string(item["status"]),
        parent: opt_string(item["parent"]),
        description: opt_string(description) || undefined,
        color: opt_string(item["color"]),
        review: parse_review(item["review"], id),
        pages: [],
        missing: [],
    };
}

function parse_review(value: unknown, id: string): Review | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === "correct" || value === "wrong") {
        return value;
    }
    log.warn(`Symbol group "${id}" has unknown review ${value}, ignored`);
    return undefined;
}

function group_to_json(group: SymbolGroup): Record<string, unknown> {
    return omit_undefined({
        id: group.id,
        refs: group.refs.map((r) => r.text),
        label: group.label == group.id ? undefined : group.label,
        kind: group.kind,
        status: group.status,
        parent: group.parent,
        description: group.description?.split("\n"),
        color: group.color,
    });
}

function omit_undefined(object: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(object).filter(([, value]) => value !== undefined),
    );
}

function is_object(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function opt_string(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}
