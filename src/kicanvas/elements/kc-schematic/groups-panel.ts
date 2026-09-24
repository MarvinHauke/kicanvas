/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { later } from "../../../base/async";
import { listen } from "../../../base/events";
import { css, html, query } from "../../../base/web-components";
import {
    KCUIButtonElement,
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
import {
    SymbolGroupSet,
    step_id,
    type GroupPart,
    type Review,
    type SymbolGroup,
} from "../../groups";
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
 * Groups can be reviewed as correct or wrong, and the reviews exported as
 * JSON in the same format.
 *
 * When a symbol is selected in the viewer, the groups it belongs to are
 * listed above the other groups.
 */
/** Keyboard shortcuts of the panel, vim style. */
const shortcuts = [
    ["j", "next group", "Move"],
    ["k", "previous group", "Move"],
    ["gg", "first group", "Move"],
    ["G", "last group", "Move"],
    ["n", "next unreviewed", "Move"],
    ["N", "previous unreviewed", "Move"],
    ["y", "correct / clear", "Review"],
    ["x", "wrong / clear", "Review"],
    ["u", "undo last review", "Review"],
    [":w", "export reviews", "Review"],
    ["zz", "zoom to group", "Zoom"],
    ["zs", "zoom to selected symbol", "Zoom"],
    ["zp", "zoom to page", "Zoom"],
    ["+", "zoom in", "Zoom"],
    ["-", "zoom out", "Zoom"],
    ["/", "search", "Other"],
    ["Escape", "close / clear selection", "Other"],
    ["?", "show shortcuts", "Other"],
] as const;

type Shortcut = (typeof shortcuts)[number][0];

/** Keys that are only pressed together with others. */
const modifier_keys = ["Shift", "Control", "Alt", "Meta", "CapsLock"];

/** Delay before the shortcuts popup shows how a started shortcut goes on. */
const which_key_delay = 400;

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

            .review {
                display: flex;
                gap: 0.5em;
                margin: 0.25em 0.2em;
            }

            .review kc-ui-button {
                flex: 1 1 0;
                min-width: 0;
            }

            .review kc-ui-button::part(base) {
                width: 100%;
                justify-content: center;
                white-space: nowrap;
            }

            .review kc-ui-button[selected]::part(base) {
                background: var(--list-item-active-bg);
                color: var(--list-item-active-fg);
            }

            .which-key {
                position: fixed;
                z-index: 20;
                box-sizing: border-box;
                max-height: 50vh;
                overflow: auto;
                padding: 0.5em 1em 0.75em 1em;
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(14em, 1fr));
                gap: 0.2em 1.5em;
                background: var(--panel-bg);
                color: var(--panel-fg);
                border-top: 2px solid var(--panel-title-bg);
                box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.4);
            }

            .which-key[hidden] {
                display: none;
            }

            .which-key .section {
                grid-column: 1 / -1;
                margin-top: 0.3em;
                color: var(--panel-subtitle-fg);
                background: var(--panel-subtitle-bg);
                padding: 0.1em 0.3em;
            }

            .which-key kbd {
                display: inline-block;
                min-width: 2em;
                font-family: monospace;
                font-weight: bold;
                color: var(--input-accent);
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

    @query(".which-key", true)
    private which_key_elm!: HTMLElement;

    #part_symbol: SchematicSymbol | null = null;

    /** Symbol uuid to select once the sheet being switched to is loaded. */
    #pending_symbol: string | null = null;

    /** True if reviews changed since they were last exported. */
    #unexported = false;

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

        this.addDisposable(
            listen(this.groups, SymbolGroupSet.review_event, (e) => {
                this.#unexported = true;
                this.#update_review((e as CustomEvent).detail as SymbolGroup);
            }),
        );

        // Warn before leaving the page with reviews that weren't exported.
        this.addDisposable(
            listen(window, "beforeunload", (e) => {
                if (this.#unexported) {
                    e.preventDefault();
                }
            }),
        );

        this.renderRoot.addEventListener("click", (e) => {
            const button = (e.target as HTMLElement).closest(
                "button, kc-ui-button",
            );
            const name = button?.getAttribute("name");
            const group = this.groups.selected_group;

            if (name == "clear") {
                this.groups.select(null);
            } else if (name == "export") {
                this.#export();
            } else if (group && (name == "correct" || name == "wrong")) {
                this.#toggle_review(name);
            }
        });

        // Keyboard shortcuts go to the viewer that was clicked last, or to
        // the only one on the page.
        const host = this.#host();
        this.#keys_active =
            document.getElementsByTagName(host.tagName).length <= 1;

        this.addDisposable(
            listen(window, "pointerdown", (e) => {
                this.#keys_active = e.composedPath().includes(host);
                this.#hide_which_key();
            }),
        );

        this.addDisposable(
            listen(window, "keydown", (e) => {
                this.#on_key(e as KeyboardEvent);
            }),
        );
    }

    /** Sets the review of the selected group, or clears it if it's set. */
    #toggle_review(review: Review) {
        const group = this.groups.selected_group;
        if (group) {
            this.groups.set_review(
                group.id,
                group.review == review ? null : review,
            );
        }
    }

    /** The element on the page that contains this panel. */
    #host(): Element {
        let host: Element | undefined;
        let root = this.getRootNode();
        while (root instanceof ShadowRoot) {
            host = root.host;
            root = host.getRootNode();
        }
        return host ?? this;
    }

    #keys_active = false;

    /** Keys typed so far of a shortcut with several keys, such as "gg". */
    #pending_keys = "";

    #on_key(e: KeyboardEvent) {
        // Only while the panel is shown.
        if (
            !this.#keys_active ||
            e.ctrlKey ||
            e.metaKey ||
            e.altKey ||
            !this.getBoundingClientRect().width
        ) {
            return;
        }

        const target = e.composedPath()[0];
        if (
            target instanceof HTMLElement &&
            target.closest("input, textarea, select, [contenteditable]")
        ) {
            if (e.key == "Escape") {
                target.blur();
            }
            return;
        }

        if (modifier_keys.includes(e.key)) {
            return;
        }

        const keys = this.#pending_keys + e.key;
        this.#pending_keys = "";

        const popup_open = !this.which_key_elm.hidden;
        this.#hide_which_key();

        const shortcut = shortcuts.find(([k]) => k == keys)?.[0];
        if (shortcut) {
            e.preventDefault();
            // "?" and Escape close the popup if it's open.
            if (!(popup_open && (shortcut == "?" || shortcut == "Escape"))) {
                this.#run_shortcut(shortcut);
            }
        } else if (shortcuts.some(([k]) => k.startsWith(keys))) {
            // Like which-key: if the next key doesn't come soon, show how
            // the shortcut can go on.
            e.preventDefault();
            this.#pending_keys = keys;
            this.#which_key_timer = window.setTimeout(
                () => this.#show_which_key(keys),
                which_key_delay,
            );
        }
    }

    #which_key_timer?: number;

    /**
     * Shows the shortcuts that start with prefix, or all of them, in a
     * popup along the bottom of the viewer.
     */
    #show_which_key(prefix = "") {
        const entries = shortcuts.filter(
            ([keys]) => keys.startsWith(prefix) && keys != prefix,
        );

        const items: Node[] = [];
        let section = "";
        for (const [keys, description, entry_section] of entries) {
            if (!prefix && entry_section != section) {
                section = entry_section;
                items.push(html`<div class="section">${section}</div>`);
            }
            const shown = keys == "Escape" ? "Esc" : keys.slice(prefix.length);
            items.push(html`<div><kbd>${shown}</kbd> ${description}</div>`);
        }

        if (prefix) {
            items.unshift(html`<div class="section">${prefix} …</div>`);
        }

        const rect = this.#host().getBoundingClientRect();
        Object.assign(this.which_key_elm.style, {
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            bottom: `${window.innerHeight - rect.bottom}px`,
        });

        this.which_key_elm.replaceChildren(...items);
        this.which_key_elm.hidden = false;
    }

    #hide_which_key() {
        window.clearTimeout(this.#which_key_timer);
        this.which_key_elm.hidden = true;
    }

    #run_shortcut(shortcut: Shortcut) {
        const ids = this.#listed_ids();
        const selected = this.groups.selected;
        const unreviewed = (id: string) =>
            this.groups.by_id(id)?.review === undefined;

        switch (shortcut) {
            case "j":
            case "k":
                this.#go_to(step_id(ids, selected, shortcut == "j" ? 1 : -1));
                break;
            case "gg":
                this.#go_to(ids[0]);
                break;
            case "G":
                this.#go_to(ids.at(-1));
                break;
            case "n":
            case "N":
                this.#go_to(
                    step_id(
                        ids,
                        selected,
                        shortcut == "n" ? 1 : -1,
                        unreviewed,
                    ),
                );
                break;
            case "y":
                this.#toggle_review("correct");
                break;
            case "x":
                this.#toggle_review("wrong");
                break;
            case "u":
                this.#go_to(this.groups.undo_review()?.id);
                break;
            case "/":
                this.search_input_elm.renderRoot
                    .querySelector("input")
                    ?.focus();
                break;
            case "Escape":
                this.groups.select(null);
                break;
            case ":w":
                this.#export();
                break;
            case "?":
                this.#show_which_key();
                break;
            case "zz": {
                const group = this.groups.selected_group;
                if (group) {
                    this.viewer.zoom_to_refs(group.refs);
                }
                break;
            }
            case "zs":
                this.viewer.zoom_to_selection();
                break;
            case "zp":
                this.viewer.zoom_to_page();
                break;
            case "+":
                this.viewer.zoom_by(1.5);
                break;
            case "-":
                this.viewer.zoom_by(1 / 1.5);
                break;
        }
    }

    /** Ids of the groups in the list, in list order, without filtered ones. */
    #listed_ids(): string[] {
        return [
            ...this.menu.querySelectorAll<KCUIMenuItemElement>(
                "kc-ui-menu-item",
            ),
        ]
            .filter((item) => item.style.display != "none")
            .map((item) => item.name);
    }

    /** Selects a group and scrolls it into view. */
    #go_to(id: string | undefined) {
        if (id === undefined) {
            return;
        }
        this.groups.select(id);
        this.menu.item_by_name(id)?.scrollIntoView({ block: "nearest" });
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

        const review_buttons = (
            [
                ["correct", "✓ Correct"],
                ["wrong", "✗ Wrong"],
            ] as const
        ).map(([review, text]) => {
            const button = html`<kc-ui-button
                name="${review}"
                variant="outline"
                title="Mark as ${review}, again to clear">
                ${text}
            </kc-ui-button>` as KCUIButtonElement;
            button.selected = group.review == review;
            return button;
        });

        this.details_elm.replaceChildren(
            html`<kc-ui-panel-label>${group.label}</kc-ui-panel-label>`,
            html`<div class="review">${review_buttons}</div>`,
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
            <span class="marks">${this.#marks(group)}</span>
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

    /** Downloads the groups with their reviews as JSON. */
    #export() {
        const json = JSON.stringify(this.groups.to_json(), null, 2) + "\n";
        const name = (this.groups.title ?? "groups").replace(
            /[\\/:*?"<>|]/g,
            "_",
        );

        const url = URL.createObjectURL(
            new Blob([json], { type: "application/json" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = `${name}.groups.json`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);

        this.#unexported = false;
    }

    /** Shows a changed review in the list, the details and the progress. */
    #update_review(group: SymbolGroup) {
        const marks = this.menu.item_by_name(group.id)?.querySelector(".marks");
        if (marks) {
            marks.textContent = this.#marks(group);
        }

        const info = this.renderRoot.querySelector(".info");
        if (info) {
            info.textContent = this.#info();
        }

        if (group.id == this.groups.selected) {
            this.#render_details();
        }
    }

    #marks(group: SymbolGroup) {
        const marks = [];
        if (group.review == "correct") {
            marks.push("✓");
        }
        if (group.review == "wrong") {
            marks.push("✗");
        }
        if (group.status == "ambiguous") {
            marks.push("?");
        }
        if (group.missing.length) {
            marks.push("!");
        }
        return marks.join(" ");
    }

    /** Title, source and review progress of the groups. */
    #info() {
        const reviewed = this.groups.groups.filter(
            (g) => g.review !== undefined,
        ).length;

        return [
            this.groups.title,
            this.groups.source,
            `${reviewed}/${this.groups.groups.length} reviewed`,
        ]
            .filter((t) => t)
            .join(" · ");
    }

    #entry(group: SymbolGroup, depth: number): HTMLElement[] {
        const sheets = group.pages
            .map(({ page }) => page.name ?? page.filename)
            .join(", ");
        const tooltip = [
            group.refs.map((r) => r.text).join(" "),
            sheets ? `on ${sheets}` : "not found",
            group.missing.length ? `missing: ${group.missing.join(" ")}` : null,
            group.status == "ambiguous" ? "ambiguous" : null,
            group.review ? `reviewed: ${group.review}` : null,
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
            <span class="marks">${this.#marks(group)}</span>
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
                    <button
                        slot="actions"
                        type="button"
                        name="export"
                        title="Export reviews as JSON">
                        <kc-ui-icon>download</kc-ui-icon>
                    </button>
                </kc-ui-panel-title>
                <kc-ui-panel-body>
                    <div class="which-key" hidden></div>
                    <kc-ui-panel-label
                        class="info"
                        title="Press ? for keyboard shortcuts"
                        >${this.#info()}</kc-ui-panel-label
                    >
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
