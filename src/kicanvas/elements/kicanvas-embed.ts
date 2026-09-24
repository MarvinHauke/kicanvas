/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { later } from "../../base/async";
import { Color } from "../../base/color";
import { Logger } from "../../base/log";
import {
    CSS,
    CustomElement,
    attribute,
    css,
    html,
} from "../../base/web-components";
import { KCUIElement } from "../../kc-ui";
import kc_ui_styles from "../../kc-ui/kc-ui.css";
import type { HighlightGroup } from "../../viewers/base/highlights";
import { SymbolGroupSet, type SymbolGroup } from "../groups";
import { group_color, parse_flag } from "../highlights";
import { Project } from "../project";
import { parse_refs } from "../refs";
import {
    FetchFileSystem,
    LocalFileSystem,
    MergedFileSystem,
    type IFileSystem,
} from "../services/vfs";
import type { KCBoardAppElement } from "./kc-board/app";
import type { KCSchematicAppElement } from "./kc-schematic/app";

const log = new Logger("kicanvas:embedtag");

/**
 * kicanvas-embed tag
 */
class KiCanvasEmbedElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        new CSS(kc_ui_styles),
        css`
            :host {
                margin: 0;
                display: flex;
                position: relative;
                width: 100%;
                max-height: 100%;
                aspect-ratio: 1.414;
                background-color: aqua;
                color: var(--fg);
                font-family:
                    "Nunito", ui-rounded, "Hiragino Maru Gothic ProN",
                    Quicksand, Comfortaa, Manjari, "Arial Rounded MT Bold",
                    Calibri, source-sans-pro, sans-serif;
                contain: layout paint;
            }

            main {
                display: contents;
            }

            kc-board-app,
            kc-schematic-app {
                width: 100%;
                height: 100%;
                flex: 1;
            }
        `,
    ];

    constructor() {
        super();
        this.provideContext("project", this.#project);
        this.provideLazyContext("groups", () => this.#groups);
    }

    #project: Project = new Project();
    #groups: SymbolGroupSet | null = null;

    /**
     * Symbol groups loaded from a kicanvas-groups child, or null.
     */
    get groups(): SymbolGroupSet | null {
        return this.#groups;
    }

    @attribute({ type: String })
    src: string | null;

    @attribute({ type: Boolean })
    public loading: boolean;

    @attribute({ type: Boolean })
    public loaded: boolean;

    @attribute({ type: String })
    controls: "none" | "basic" | "full" | null;

    @attribute({ type: String })
    controlslist: string | null;

    @attribute({ type: String })
    theme: string | null;

    @attribute({ type: String })
    zoom: "objects" | "page" | string | null;

    custom_resolver: ((name: string) => URL) | null = null;

    #schematic_app: KCSchematicAppElement;
    #board_app: KCBoardAppElement;

    override initialContentCallback() {
        this.#setup_events();
        later(() => {
            this.#load_src();
        });
    }

    async #setup_events() {}

    async #load_src() {
        const url_src = [];
        const inline_file = [];

        if (this.src) {
            url_src.push(this.src);
        }

        let inline_count = 0;

        for (const src_elm of this.querySelectorAll<KiCanvasSourceElement>(
            "kicanvas-source",
        )) {
            if (src_elm.src) {
                // URL
                url_src.push(src_elm.src);
            } else if (src_elm.is_inline_source()) {
                // inline source
                const default_name = `inline_${inline_count}`;
                inline_count += 1;

                const file = src_elm.load_inline_source(default_name);

                if (file) {
                    log.info(
                        `Determined inline source ${file.name}, ${file.size} bytes`,
                    );

                    inline_file.push(file);
                }
            }
        }

        // maybe we have a better way to merge two VFS
        // we need load file from File blobs and URLs

        const url_vfs =
            url_src.length === 0
                ? null
                : new FetchFileSystem(url_src, this.custom_resolver);

        const inline_vfs =
            inline_file.length === 0 ? null : new LocalFileSystem(inline_file);

        if (url_vfs === null && inline_vfs === null) {
            log.warn("No valid sources specified");
            return;
        }

        const vfs = new MergedFileSystem([url_vfs, inline_vfs]);
        await this.#setup_project(vfs);
    }

    async #setup_project(vfs: IFileSystem) {
        this.loaded = false;
        this.loading = true;

        try {
            await vfs.setup();
            await this.#project.load(vfs);

            this.#groups = await this.#load_groups();
            this.#add_highlight_elements();
            this.#groups?.resolve(this.#project);

            this.loaded = true;
            await this.update();

            if (this.#groups) {
                this.#groups.addEventListener(SymbolGroupSet.select_event, () =>
                    this.#show_selected_group(),
                );
                this.#show_selected_group();
            }

            if (!this.#project.active_page) {
                this.#project.set_active_page(
                    this.#project.root_schematic_page!,
                );
            }
        } finally {
            this.loading = false;
        }
    }

    /**
     * Loads symbol groups from the first kicanvas-groups child, either from
     * its src URL or from JSON inside the element.
     */
    async #load_groups(): Promise<SymbolGroupSet | null> {
        const elms =
            this.querySelectorAll<KiCanvasGroupsElement>("kicanvas-groups");
        const elm = elms[0];

        if (!elm) {
            return null;
        }

        if (elms.length > 1) {
            log.warn("Only the first kicanvas-groups element is used");
        }

        try {
            let json: string;
            if (elm.src) {
                const url = new URL(elm.src, document.baseURI);
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(
                        `${response.status} ${response.statusText}`,
                    );
                }
                json = await response.text();
            } else {
                json = elm.textContent ?? "";
            }

            const groups = SymbolGroupSet.parse(json);
            log.info(`Loaded ${groups.groups.length} symbol groups`);
            return groups;
        } catch (e) {
            log.error(`Unable to load symbol groups: ${e}`);
            return null;
        }
    }

    /**
     * Adds kicanvas-highlight children as symbol groups.
     */
    #add_highlight_elements() {
        const elms =
            this.querySelectorAll<KiCanvasHighlightElement>(
                "kicanvas-highlight",
            );

        if (!elms.length) {
            return;
        }

        this.#groups ??= new SymbolGroupSet();

        let selected: string | undefined;

        for (const elm of elms) {
            const refs = parse_refs(elm.refs ?? "");
            const id = elm.label || elm.refs || "";

            if (!refs.length) {
                log.warn(`kicanvas-highlight "${id}" has no refs`);
                continue;
            }

            const added = this.#groups.add({
                id,
                refs,
                label: id,
                kind: elm.group ?? undefined,
                status: parse_flag(elm.ambiguous) ? "ambiguous" : undefined,
                description: elm.title || undefined,
                color: elm.color ?? undefined,
                pages: [],
                missing: [],
            });

            if (added && parse_flag(elm.selected)) {
                selected = id;
            }
        }

        if (selected !== undefined) {
            this.#groups.select(selected);
        }
    }

    /**
     * Shows the selected symbol group: switches to a page that has its
     * symbols, unless the current page has some, and highlights it.
     */
    #show_selected_group() {
        const group = this.#groups?.selected_group;

        if (this.#schematic_app) {
            this.#schematic_app.highlights = group
                ? [this.#highlight_for(group)]
                : [];
        }

        if (!group?.pages.length) {
            return;
        }

        const active = this.#project.active_page;
        if (!group.pages.some((p) => p.page === active)) {
            this.#project.set_active_page(group.pages[0]!.page);
        }
    }

    #highlight_for(group: SymbolGroup): HighlightGroup {
        return {
            refs: group.refs,
            label: group.missing.length
                ? `${group.label} (incomplete)`
                : group.label,
            color: group.color
                ? Color.from_css(group.color)
                : group_color(group.kind ?? group.id),
            ambiguous: group.status == "ambiguous",
            pages: group.pages.map(({ page, symbols }) => ({
                path: page.project_path,
                name: page.name ?? page.filename,
                count: symbols.length,
            })),
        };
    }

    override render() {
        if (!this.loaded) {
            return html``;
        }

        if (this.#project.has_schematics && !this.#schematic_app) {
            this.#schematic_app = html`<kc-schematic-app
                sidebarcollapsed
                controls="${this.controls}"
                controlslist="${this.controlslist}">
            </kc-schematic-app>` as KCSchematicAppElement;
            this.#schematic_app.groups = this.#groups;
        }

        if (this.#project.has_boards && !this.#board_app) {
            this.#board_app = html`<kc-board-app
                sidebarcollapsed
                controls="${this.controls}"
                controlslist="${this.controlslist}">
            </kc-board-app>` as KCBoardAppElement;
        }

        const focus_overlay =
            (this.controls ?? "none") == "none" ||
            this.controlslist?.includes("nooverlay")
                ? null
                : html`<kc-ui-focus-overlay></kc-ui-focus-overlay>`;

        return html`<main>
            ${this.#schematic_app} ${this.#board_app} ${focus_overlay}
        </main>`;
    }
}

window.customElements.define("kicanvas-embed", KiCanvasEmbedElement);

enum KiCanvasSourceType {
    Schematic = "schematic",
    Board = "board",
    Project = "project",
    Worksheet = "worksheet",
}

class KiCanvasSourceElement extends CustomElement {
    constructor() {
        super();
    }

    override connectedCallback() {
        this.ariaHidden = "true";
        this.hidden = true;
        this.style.display = "none";
        super.connectedCallback();
    }

    is_inline_source(): boolean {
        return this.src === null && this.childNodes.length > 0;
    }

    load_inline_source(default_name: string | null = null): File | undefined {
        let content = "";

        for (const child of this.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                // Get the content and triming the CR,LF,space.
                content += child.nodeValue ?? "";
            } else {
                log.warn(
                    `kicanvas-source children ${child.nodeType} are invaild.`,
                );
            }
        }

        content = content.trimStart();

        // determine the file name
        let file_name;
        if (this.name) {
            file_name = this.name;
        } else {
            const typ =
                this.type ?? KiCanvasSourceElement.determine_file_type(content);

            if (typ === undefined) {
                log.warn(
                    `Unknown file type, content: ${content.slice(0, 64)}...`,
                );
                return undefined;
            }

            const ext = KiCanvasSourceElement.get_file_ext(typ);

            file_name = (default_name ?? "noname") + ext;
        }

        if (content.length === 0) {
            log.warn(`kicanvas-source content ${file_name} is empty.`);
            return undefined;
        }

        const file_blob = new Blob([content], { type: "text/plain" });
        const file = new File([file_blob], file_name);

        return file;
    }

    private static determine_file_type(
        content: string,
    ): KiCanvasSourceType | undefined {
        if (content.startsWith("(kicad_sch")) {
            return KiCanvasSourceType.Schematic;
        } else if (content.startsWith("(kicad_pcb")) {
            return KiCanvasSourceType.Board;
        } else if (content.startsWith("(kicad_wks")) {
            return KiCanvasSourceType.Worksheet;
        } else if (content.startsWith("{")) {
            // project? maybe we need try parsing the json
            return KiCanvasSourceType.Project;
        }

        return undefined;
    }

    private static get_file_ext(typ: KiCanvasSourceType): string {
        switch (typ) {
            case KiCanvasSourceType.Schematic:
                return ".kicad_sch";
            case KiCanvasSourceType.Board:
                return ".kicad_pcb";
            case KiCanvasSourceType.Worksheet:
                return ".kicad_wks";
            case KiCanvasSourceType.Project:
                return ".kicad_prj";
        }
    }

    @attribute({ type: String })
    src: string | null;

    @attribute({ type: String })
    type: KiCanvasSourceType | null;

    @attribute({ type: String })
    name: string | null;
}

window.customElements.define("kicanvas-source", KiCanvasSourceElement);

/**
 * kicanvas-highlight tag, a symbol group given by attributes, for pages
 * written by hand. Like groups from kicanvas-groups, it's only drawn when
 * selected.
 *
 * <kicanvas-highlight refs="R1 R2 U1.A" label="#1 voltage_divider"
 *     group="voltage_divider" ambiguous selected></kicanvas-highlight>
 */
class KiCanvasHighlightElement extends CustomElement {
    override connectedCallback() {
        this.ariaHidden = "true";
        this.hidden = true;
        this.style.display = "none";
        super.connectedCallback();
    }

    /** References, separated by spaces: "R1 R2 U1.A" */
    @attribute({ type: String })
    refs: string | null;

    @attribute({ type: String })
    label: string | null;

    /** Groups with the same name get the same color. */
    @attribute({ type: String })
    group: string | null;

    /** CSS color, overrides the group color. */
    @attribute({ type: String })
    color: string | null;

    /** Draws a dashed outline. Present or "true" means true. */
    @attribute({ type: String })
    ambiguous: string | null;

    /** Selects this group when loaded. Present or "true" means true. */
    @attribute({ type: String })
    selected: string | null;
}

window.customElements.define("kicanvas-highlight", KiCanvasHighlightElement);

/**
 * kicanvas-groups tag, provides symbol groups (see groups.ts for the
 * format) either as JSON inside the element or from a URL:
 *
 * <kicanvas-groups src="review.json"></kicanvas-groups>
 * <kicanvas-groups>{"version": 1, "groups": [...]}</kicanvas-groups>
 */
class KiCanvasGroupsElement extends CustomElement {
    override connectedCallback() {
        this.ariaHidden = "true";
        this.hidden = true;
        this.style.display = "none";
        super.connectedCallback();
    }

    @attribute({ type: String })
    src: string | null;
}

window.customElements.define("kicanvas-groups", KiCanvasGroupsElement);

/* Import required fonts.
 * TODO: Package these up as part of KiCanvas
 */
document.body.appendChild(
    html`<link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@48,400,0,0&family=Nunito:wght@300;400;500;600;700&display=swap"
        crossorigin="anonymous" />`,
);
