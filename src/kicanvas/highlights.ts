/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { Color } from "../base/color";

/**
 * Colors for highlight groups, readable on light and dark themes.
 */
export const highlight_palette = [
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#17becf",
    "#bcbd22",
    "#7f7f7f",
];

/**
 * Picks a palette color for a group name. The same name always gets the
 * same color, so a type of subcircuit has the same color on every page.
 */
export function group_color(group: string): Color {
    // FNV-1a hash
    let hash = 0x811c9dc5;
    for (let i = 0; i < group.length; i++) {
        hash ^= group.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    const index = (hash >>> 0) % highlight_palette.length;
    return Color.from_css(highlight_palette[index]!);
}

/**
 * Reads a flag attribute where only a missing attribute or "false" means
 * false, so that both `ambiguous` and `ambiguous="true"` are true.
 */
export function parse_flag(value: string | null): boolean {
    return value !== null && value.trim().toLowerCase() !== "false";
}
