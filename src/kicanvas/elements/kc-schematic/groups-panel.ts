/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { listen } from "../../../base/events";
import { css, html, query } from "../../../base/web-components";
import {
    KCUIElement,
    KCUIFilteredListElement,
    KCUITextFilterInputElement,
    type KCUIMenuElement,
    type KCUIMenuItemElement,
} from "../../../kc-ui";
import { SymbolGroupSet, type SymbolGroup } from "../../groups";

/**
 * Lists symbol groups, such as subcircuits, grouped by kind with nested
 * groups under their parent. Selecting an entry selects the group.
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

            .marks {
                flex: 0 0 auto;
                max-width: 4em;
                text-align: right;
                opacity: 0.8;
            }
        `,
    ];

    groups: SymbolGroupSet;

    @query("kc-ui-menu")
    private menu!: KCUIMenuElement;

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
                this.#sync_selected();
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

        this.#sync_selected();
    }

    #sync_selected() {
        this.#updating_selected = true;
        this.menu.selected = this.groups.selected ?? null;
        this.#updating_selected = false;
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
                    <kc-ui-text-filter-input></kc-ui-text-filter-input>
                    <kc-ui-filtered-list>
                        <kc-ui-menu class="outline">${entries}</kc-ui-menu>
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
