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
 *      "color": "#e377c2"              // optional, CSS color
 *    }],
 *    "parts": {                        // optional, info about symbols
 *      "C2": { "kind": "capacitor_polarized", "value": "47uF" }
 *    }
 *  }
 *
 * Unknown fields are ignored.
 */

export interface SymbolGroup {
    id: string;
    refs: RefQuery[];
    label: string;
    kind?: string;
    status?: string;
    parent?: string;
    description?: string;
    color?: string;
    /** Pages with symbols of this group, set by SymbolGroupSet.resolve(). */
    pages: ResolvedPage[];
    /** References that weren't found, set by SymbolGroupSet.resolve(). */
    missing: string[];
}

export interface PartInfo {
    kind?: string;
    value?: string;
}

export class SymbolGroupSet extends EventTarget {
    /** Fired when the selected group changes, detail is the group or null. */
    static readonly select_event = "kicanvas:groups:select";

    title?: string;
    source?: string;
    reviewed?: boolean;
    groups: SymbolGroup[] = [];
    parts: Map<string, PartInfo> = new Map();

    #by_id: Map<string, SymbolGroup> = new Map();
    #selected?: string;

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
            set.add(group);
        }

        for (const group of set.groups) {
            if (group.parent !== undefined && !set.#by_id.has(group.parent)) {
                log.warn(
                    `Symbol group "${group.id}" has unknown parent "${group.parent}"`,
                );
                group.parent = undefined;
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

    /** Groups that contain a symbol with the given reference. */
    groups_with_ref(reference: string): SymbolGroup[] {
        return this.groups.filter((g) =>
            g.refs.some((q) => q.ref === reference),
        );
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
        pages: [],
        missing: [],
    };
}

function is_object(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function opt_string(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}
