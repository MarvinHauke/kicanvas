/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { KicadSch, type SchematicSymbol } from "../kicad/schematic";
import type { Project, ProjectPage } from "./project";

/**
 * A single reference from a reference list, such as "R3" or "U2.A".
 */
export interface RefQuery {
    /** The text as written, used for reporting missing references. */
    text: string;
    ref: string;
    /** Unit number (A = 1), or undefined to match all units. */
    unit?: number;
}

export interface ResolvedPage {
    page: ProjectPage;
    symbols: SchematicSymbol[];
}

export interface ResolvedRefs {
    pages: ResolvedPage[];
    missing: string[];
}

/**
 * Converts a unit suffix into a unit number, the inverse of
 * SchematicSymbol.unit_suffix: A = 1, Z = 26, AA = 27.
 */
export function unit_from_suffix(suffix: string): number {
    let unit = 0;
    for (const c of suffix.toUpperCase()) {
        unit = unit * 26 + (c.charCodeAt(0) - "A".charCodeAt(0) + 1);
    }
    return unit;
}

/**
 * Converts a unit number into a unit suffix, the inverse of
 * unit_from_suffix(): 1 = A, 26 = Z, 27 = AA.
 */
export function suffix_from_unit(unit: number): string {
    const A = "A".charCodeAt(0);
    let suffix = "";
    while (unit > 0) {
        const x = (unit - 1) % 26;
        suffix = String.fromCharCode(A + x) + suffix;
        unit = (unit - 1 - x) / 26;
    }
    return suffix;
}

/**
 * Parses a list of references separated by spaces or commas, such as
 * "R1 R2 U2.A". A reference with a unit suffix ("U2.A") only matches that
 * unit, a plain reference ("U2") matches all units.
 */
export function parse_refs(refs: string): RefQuery[] {
    const queries: RefQuery[] = [];

    for (const text of refs.split(/[\s,]+/)) {
        if (!text) {
            continue;
        }

        const match = /^(.+)\.([A-Za-z]+)$/.exec(text);
        if (match) {
            queries.push({
                text,
                ref: match[1]!,
                unit: unit_from_suffix(match[2]!),
            });
        } else {
            queries.push({ text, ref: text });
        }
    }

    return queries;
}

/**
 * True if a symbol with the given reference and unit is named by the query.
 */
export function ref_matches(query: RefQuery, reference: string, unit?: number) {
    return (
        query.ref == reference &&
        (query.unit === undefined || query.unit == unit)
    );
}

/**
 * Finds the symbols named by a list of references on all schematic pages
 * of the project.
 *
 * References are resolved per page, so symbols on sheets that are used
 * multiple times are found by the reference they have on each instance of
 * the sheet, regardless of which page is currently shown.
 */
export function resolve_refs(
    project: Project,
    refs: string | RefQuery[],
): ResolvedRefs {
    const queries = typeof refs === "string" ? parse_refs(refs) : refs;
    const found = new Set<RefQuery>();
    const pages: ResolvedPage[] = [];

    for (const page of project.pages()) {
        const doc = page.document;

        if (!(doc instanceof KicadSch)) {
            continue;
        }

        const symbols: SchematicSymbol[] = [];

        for (const symbol of doc.symbols.values()) {
            const instance = doc.symbol_instance_data(symbol, page.sheet_path);
            const reference = instance?.reference ?? symbol.reference;
            const unit = instance?.unit ?? symbol.unit;

            for (const query of queries) {
                if (ref_matches(query, reference, unit)) {
                    symbols.push(symbol);
                    found.add(query);
                    break;
                }
            }
        }

        if (symbols.length) {
            pages.push({ page, symbols });
        }
    }

    const missing = queries.filter((q) => !found.has(q)).map((q) => q.text);

    return { pages, missing };
}
