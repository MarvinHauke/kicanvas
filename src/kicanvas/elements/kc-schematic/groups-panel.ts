/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { later } from "../../../base/async";
import { listen } from "../../../base/events";
import { css, html, query } from "../../../base/web-components";
import {
    KCUIElement,
    KCUIFilteredListElement,
    KCUITextFilterInputElement,
    type KCUIMenuElement,
    type KCUIMenuItemElement,
} from "../../../kc-ui";
import { SchematicSymbol } from "../../../kicad/schematic";
import {
    KiCanvasLoadEvent,
    KiCanvasSelectEvent,
} from "../../../viewers/base/events";
import type { SchematicViewer } from "../../../viewers/schematic/viewer";
import { SymbolGroupSet, type GroupPart, type SymbolGroup } from "../../groups";
import type { Project } from "../../project";
import { ref_matches, resolve_refs } from "../../refs";

/**
 * Lists symbol groups, such as subcircuits, grouped by kind with nested
 * groups under their parent. Selecting an entry selects the group.
 *
 * The selected group is shown with its details: kind, status, description,
 * related groups and parts. Selecting a part selects its symbol, switching
 * to the sheet it's on if needed.
 *
 * When a symbol is selected in the viewer, the groups it belongs to are
 * listed above the other groups.
 */
export class KCSchematicGroupsPanelElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            kc-ui-panel-title button {
                all: unset;
                flex-shrink: 0;
                margin-left: 1em;
                border: 0 none;
                background: transparent;
                padding: 0 0.25em 0 0.25em;
                margin-right: -0.25em;
                display: flex;
                align-items: center;
                cursor: pointer;
            }

            .part-groups:empty,
            .details:empty {
                display: none;
            }

            .details {
                margin-bottom: 0.5em;
            }

            .details p {
                margin: 0.25em 0.2em;
                white-space: pre-wrap;
            }

            .part-ref {
                flex: 0 0 auto;
            }

            .part-kind {
                flex: 1 1 auto;
                margin-left: 1em;
                text-align: right;
                opacity: 0.8;
            }

            .marks {
                flex: 0 0 auto;
                max-width: 4em;
                text-align: right;
                opacity: 0.8;
            }
        `,
    ];

    groups: SymbolGroupSet;
    viewer: SchematicViewer;
    project: Project;

    @query("kc-ui-menu#groups")
    private menu!: KCUIMenuElement;

    @query(".part-groups", true)
    private part_groups_elm!: HTMLElement;

    @query(".details", true)
    private details_elm!: HTMLElement;

    #part_symbol: SchematicSymbol | null = null;

    /** Symbol uuid to select once the sheet being switched to is loaded. */
    #pending_symbol: string | null = null;

    override connectedCallback() {
        (async () => {
            this.project = await this.requestContext("project");
            this.viewer = await this.requestLazyContext("viewer");
            await this.viewer.loaded;
            super.connectedCallback();
        })();
    }

    @query("kc-ui-text-filter-input", true)
    private search_input_elm!: KCUITextFilterInputElement;

    @query("kc-ui-filtered-list", true)
    private item_filter_elem!: KCUIFilteredListElement;

    #updating_selected = false;

    override initialContentCallback() {
        this.addEventListener("kc-ui-menu:select", (e) => {
            if (this.#updating_selected) {
                return;
            }

            const item = (e as CustomEvent).detail as KCUIMenuItemElement;
            if (item.name) {
                this.groups.select(item.name);
            }
        });

        // Follow selection changes made elsewhere, e.g. by the page.
        this.addDisposable(
            listen(this.groups, SymbolGroupSet.select_event, () => {
                this.#render_details();
                this.#sync_selected();
            }),
        );

        // Show the groups of the symbol selected in the viewer.
        this.addDisposable(
            this.viewer.addEventListener(KiCanvasSelectEvent.type, (e) => {
                const item = e.detail.item;
                this.#part_symbol =
                    item instanceof SchematicSymbol ? item : null;
                this.#render_part_groups();
                this.#sync_selected_part();
            }),
        );

        this.addDisposable(
            this.viewer.addEventListener(KiCanvasLoadEvent.type, () => {
                this.#part_symbol = null;
                this.#render_part_groups();
                this.#sync_selected_part();

                // Select after the viewer finished loading, loading clears
                // the selection.
                const pending = this.#pending_symbol;
                this.#pending_symbol = null;
                if (pending) {
                    later(() => this.viewer.select(pending));
                }
            }),
        );

        this.renderRoot.addEventListener("click", (e) => {
            const button = (e.target as HTMLElement).closest("button");
            if (button?.name == "clear") {
                this.groups.select(null);
            }
        });
    }

    override renderedCallback() {
        this.search_input_elm.addEventListener("input", () => {
            this.item_filter_elem.filter_text =
                this.search_input_elm.value ?? null;
        });

        this.#render_part_groups();
        this.#render_details();
        this.#sync_selected();
    }

    #sync_selected() {
        this.#updating_selected = true;
        this.menu.selected = this.groups.selected ?? null;
        const part_menu =
            this.part_groups_elm.querySelector<KCUIMenuElement>("kc-ui-menu");
        if (part_menu) {
            part_menu.selected = this.groups.selected ?? null;
        }
        this.#updating_selected = false;
    }

    /** Marks the part of the symbol selected in the viewer, if listed. */
    #sync_selected_part() {
        const menu =
            this.details_elm.querySelector<KCUIMenuElement>("kc-ui-menu.parts");
        if (!menu) {
            return;
        }

        const symbol = this.#part_symbol;
        const part = symbol
            ? this.#parts.find((p) =>
                  ref_matches(p.query, symbol.reference, symbol.unit),
              )
            : undefined;

        this.#updating_selected = true;
        menu.selected = part?.query.text ?? null;
        this.#updating_selected = false;
    }

    #parts: GroupPart[] = [];

    /**
     * Selects the symbol of a part, switching to the sheet it's on unless
     * it's on the sheet being shown.
     */
    #select_part(part: GroupPart) {
        const { pages } = resolve_refs(this.project, [part.query]);
        const active = this.project.active_page;
        const found = pages.find((p) => p.page === active) ?? pages[0];
        const uuid = found?.symbols[0]?.uuid;

        if (!found || !uuid) {
            return;
        }

        if (found.page === active) {
            this.viewer.select(uuid);
        } else {
            this.#pending_symbol = uuid;
            this.project.set_active_page(found.page);
        }
    }

    /**
     * Shows the selected group: its kind, status, description, parent and
     * children, and its parts. Nothing is shown if no group is selected.
     */
    #render_details() {
        const group = this.groups.selected_group;

        if (!group) {
            this.#parts = [];
            this.details_elm.replaceChildren();
            return;
        }

        this.#parts = this.groups.parts_of(group);

        const properties = [
            ["Kind", group.kind],
            ["Status", group.status],
        ]
            .filter(([, value]) => value)
            .map(
                ([name, value]) =>
                    html`<kc-ui-property-list-item name="${name}">
                        ${value}
                    </kc-ui-property-list-item>`,
            );

        const description = (group.description ?? "")
            .split("\n")
            .filter((line) => line)
            .map((line) => html`<p>${line}</p>`);

        const parent = group.parent
            ? this.groups.by_id(group.parent)
            : undefined;
        const children = this.groups.children(group.id);
        const related = [
            ...(parent
                ? [html`<kc-ui-menu-label>Part of</kc-ui-menu-label>`]
                : []),
            ...(parent ? [this.#group_link(parent)] : []),
            ...(children.length
                ? [
                      html`<kc-ui-menu-label>
                          Contains (${children.length})
                      </kc-ui-menu-label>`,
                  ]
                : []),
            ...children.map((child) => this.#group_link(child)),
        ];

        const part_items = this.#parts.map((part) => {
            const info = [part.kind, part.value].filter((t) => t).join(" · ");
            const item = html`<kc-ui-menu-item
                name="${part.query.text}"
                title="${part.missing ? "not found" : "select symbol"}">
                <span class="part-ref">${part.query.text}</span>
                <span class="part-kind" title="${info}">${info}</span>
                <span class="marks">${part.missing ? "!" : ""}</span>
            </kc-ui-menu-item>` as KCUIMenuItemElement;
            item.disabled = part.missing;
            return item;
        });

        const parts_menu = html`<kc-ui-menu class="outline parts"
            >${part_items}</kc-ui-menu
        >` as KCUIMenuElement;

        parts_menu.addEventListener("kc-ui-menu:select", (e) => {
            // Parts aren't groups, keep the panel from selecting one.
            e.stopPropagation();

            if (this.#updating_selected) {
                return;
            }

            const item = (e as CustomEvent).detail as KCUIMenuItemElement;
            const part = this.#parts.find((p) => p.query.text == item.name);
            if (part && !part.missing) {
                this.#select_part(part);
            }
        });

        this.details_elm.replaceChildren(
            html`<kc-ui-panel-label>${group.label}</kc-ui-panel-label>`,
            ...(properties.length
                ? [
                      html`<kc-ui-property-list
                          >${properties}</kc-ui-property-list
                      >`,
                  ]
                : []),
            ...description,
            ...(related.length
                ? [html`<kc-ui-menu class="outline">${related}</kc-ui-menu>`]
                : []),
            html`<kc-ui-menu-label
                >Parts (${this.#parts.length})</kc-ui-menu-label
            >`,
            parts_menu,
        );

        this.#sync_selected_part();
    }

    #group_link(group: SymbolGroup) {
        return html`<kc-ui-menu-item name="${group.id}" title="select group">
            <span>${group.label}</span>
            <span class="marks">${group.kind ?? ""}</span>
        </kc-ui-menu-item>`;
    }

    /**
     * Lists the groups of the symbol selected in the viewer, or nothing if
     * no symbol is selected.
     */
    #render_part_groups() {
        const symbol = this.#part_symbol;

        if (!symbol) {
            this.part_groups_elm.replaceChildren();
            return;
        }

        // References and units are those of the sheet instance being shown.
        const name = `${symbol.reference}${symbol.unit_suffix}`;
        const groups = this.groups.groups_with_symbol(
            symbol.reference,
            symbol.unit,
        );

        const label = groups.length
            ? `${name} is in`
            : `${name} is in no subcircuit`;

        const items = groups.map(
            (g) =>
                html`<kc-ui-menu-item name="${g.id}" data-match-text="${g.id}">
                    <span>${g.label}</span>
                </kc-ui-menu-item>`,
        );

        this.part_groups_elm.replaceChildren(
            html`<kc-ui-panel-label>${label}</kc-ui-panel-label>`,
            ...(items.length
                ? [html`<kc-ui-menu class="outline">${items}</kc-ui-menu>`]
                : []),
        );

        this.#sync_selected();
    }

    #entry(group: SymbolGroup, depth: number): HTMLElement[] {
        const marks = [];
        if (group.status == "ambiguous") {
            marks.push("?");
        }
        if (group.missing.length) {
            marks.push("!");
        }

        const sheets = group.pages
            .map(({ page }) => page.name ?? page.filename)
            .join(", ");
        const tooltip = [
            group.refs.map((r) => r.text).join(" "),
            sheets ? `on ${sheets}` : "not found",
            group.missing.length ? `missing: ${group.missing.join(" ")}` : null,
            group.status == "ambiguous" ? "ambiguous" : null,
        ]
            .filter((t) => t)
            .join("\n");

        const match_text = [
            group.id,
            group.label,
            group.kind ?? "",
            group.refs.map((r) => r.text).join(" "),
        ].join(" ");

        const entry = html`<kc-ui-menu-item
            name="${group.id}"
            title="${tooltip}"
            data-match-text="${match_text}">
            <span style="padding-left: ${depth * 1.2}em">
                ${depth ? "└ " : ""}${group.label}
            </span>
            <span class="marks">${marks.join(" ")}</span>
        </kc-ui-menu-item>` as HTMLElement;

        return [
            entry,
            ...this.groups
                .children(group.id)
                .flatMap((child) => this.#entry(child, depth + 1)),
        ];
    }

    override render() {
        const by_kind = new Map<string, SymbolGroup[]>();
        for (const group of this.groups.top_level) {
            const kind = group.kind ?? "other";
            by_kind.set(kind, [...(by_kind.get(kind) ?? []), group]);
        }

        const entries: HTMLElement[] = [];
        for (const [kind, groups] of by_kind) {
            entries.push(
                html`<kc-ui-menu-label>
                    ${kind} (${groups.length})
                </kc-ui-menu-label>` as HTMLElement,
            );
            for (const group of groups) {
                entries.push(...this.#entry(group, 0));
            }
        }

        const info = [
            this.groups.title,
            this.groups.source,
            this.groups.reviewed === undefined
                ? null
                : this.groups.reviewed
                  ? "reviewed"
                  : "not reviewed",
        ]
            .filter((t) => t)
            .join(" · ");

        return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Subcircuits">
                    <button
                        slot="actions"
                        type="button"
                        name="clear"
                        title="Clear selection">
                        <kc-ui-icon>deselect</kc-ui-icon>
                    </button>
                </kc-ui-panel-title>
                <kc-ui-panel-body>
                    ${info
                        ? html`<kc-ui-panel-label>${info}</kc-ui-panel-label>`
                        : null}
                    <div class="details"></div>
                    <div class="part-groups"></div>
                    <kc-ui-text-filter-input></kc-ui-text-filter-input>
                    <kc-ui-filtered-list>
                        <kc-ui-menu id="groups" class="outline"
                            >${entries}</kc-ui-menu
                        >
                    </kc-ui-filtered-list>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
    }
}

window.customElements.define(
    "kc-schematic-groups-panel",
    KCSchematicGroupsPanelElement,
);
