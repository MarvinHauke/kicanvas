/*
    Copyright (c) 2022 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { Barrier, later } from "../../base/async";
import { Disposables, type IDisposable } from "../../base/disposable";
import { listen } from "../../base/events";
import { no_self_recursion } from "../../base/functions";
import { BBox, Vec2 } from "../../base/math";
import { Color, Polygon, Polyline, Renderer } from "../../graphics";
import type { RefQuery } from "../../kicanvas/refs";
import {
    KiCanvasLoadEvent,
    KiCanvasMouseMoveEvent,
    KiCanvasSelectEvent,
    type KiCanvasEventMap,
} from "./events";
import { paint_highlight, type HighlightGroup } from "./highlights";
import { ViewLayerSet } from "./view-layers";
import { Viewport } from "./viewport";

export abstract class Viewer extends EventTarget {
    public renderer: Renderer;
    public viewport: Viewport;
    public layers: ViewLayerSet;
    public mouse_position: Vec2 = new Vec2(0, 0);
    public loaded = new Barrier();

    protected disposables = new Disposables();
    protected setup_finished = new Barrier();

    #selected: BBox | null;
    #highlights: HighlightGroup[] = [];

    constructor(
        public canvas: HTMLCanvasElement,
        protected interactive = true,
    ) {
        super();
    }

    dispose() {
        this.disposables.dispose();
    }

    override addEventListener<K extends keyof KiCanvasEventMap>(
        type: K,
        listener:
            | ((this: Viewer, ev: KiCanvasEventMap[K]) => void)
            | { handleEvent: (ev: KiCanvasEventMap[K]) => void }
            | null,
        options?: boolean | AddEventListenerOptions,
    ): IDisposable;
    override addEventListener(
        type: string,
        listener: EventListener | null,
        options?: boolean | AddEventListenerOptions,
    ): IDisposable {
        super.addEventListener(type, listener, options);
        return {
            dispose: () => {
                this.removeEventListener(type, listener, options);
            },
        };
    }

    protected abstract create_renderer(canvas: HTMLCanvasElement): Renderer;

    async setup() {
        this.renderer = this.disposables.add(this.create_renderer(this.canvas));

        await this.renderer.setup();

        this.viewport = this.disposables.add(
            new Viewport(this.renderer, () => {
                this.on_viewport_change();
            }),
        );

        if (this.interactive) {
            this.viewport.enable_pan_and_zoom(0.5, 190);

            this.disposables.add(
                listen(this.canvas, "mousemove", (e) => {
                    this.on_mouse_change(e);
                }),
            );

            this.disposables.add(
                listen(this.canvas, "panzoom", (e) => {
                    this.on_mouse_change(e as MouseEvent);
                }),
            );

            this.disposables.add(
                listen(this.canvas, "click", (e) => {
                    const items = this.layers.query_point(this.mouse_position);
                    this.on_pick(this.mouse_position, items);
                }),
            );
        }

        this.setup_finished.open();
    }

    protected on_viewport_change() {
        if (this.interactive) {
            this.draw();
        }
    }

    protected on_mouse_change(e: MouseEvent) {
        const rect = this.canvas.getBoundingClientRect();
        const new_position = this.viewport.camera.screen_to_world(
            new Vec2(e.clientX - rect.left, e.clientY - rect.top),
        );

        if (
            this.mouse_position.x != new_position.x ||
            this.mouse_position.y != new_position.y
        ) {
            this.mouse_position.set(new_position);
            this.dispatchEvent(new KiCanvasMouseMoveEvent(this.mouse_position));
        }
    }

    public abstract load(src: any): Promise<void>;

    protected resolve_loaded(value: boolean) {
        if (value) {
            this.loaded.open();
            this.dispatchEvent(new KiCanvasLoadEvent());
        }
    }

    public abstract paint(): void;

    protected on_draw() {
        this.renderer.clear_canvas();

        if (!this.layers) {
            return;
        }

        // Render all layers in display order (back to front)
        let depth = 0.01;
        const camera = this.viewport.camera.matrix;
        const should_dim = this.layers.is_any_layer_highlighted();

        // TODO: donot flip drawing sheet and grid

        for (const layer of this.layers.in_display_order()) {
            if (layer.visible && layer.graphics) {
                let alpha = layer.opacity;

                if (should_dim && !layer.highlighted) {
                    alpha = 0.25;
                }

                layer.graphics.render(camera, depth, alpha);
                depth += 0.01;
            }
        }
    }

    public draw() {
        if (!this.viewport) {
            return;
        }

        window.requestAnimationFrame(() => {
            this.on_draw();
        });
    }

    protected on_pick(
        mouse: Vec2,
        items: ReturnType<ViewLayerSet["query_point"]>,
    ) {
        let selected = null;

        for (const { bbox } of items) {
            selected = bbox;
            break;
        }

        this.select(selected);
    }

    public select(item: BBox | null) {
        this.selected = item;
    }

    public get selected(): BBox | null {
        return this.#selected;
    }

    public set selected(bb: BBox | null) {
        this._set_selected(bb);
    }

    @no_self_recursion
    private _set_selected(bb: BBox | null) {
        const previous = this.#selected;
        this.#selected = bb?.copy() || null;

        // Notify event listeners
        this.dispatchEvent(
            new KiCanvasSelectEvent({
                item: this.#selected?.context,
                previous: previous?.context,
            }),
        );

        later(() => this.paint_selected());
    }

    public get selection_color() {
        return Color.white;
    }

    protected paint_selected() {
        const layer = this.layers.overlay;

        layer.clear();

        if (this.#selected) {
            const bb = this.#selected.copy().grow(this.#selected.w * 0.1);
            this.renderer.start_layer(layer.name);

            this.renderer.line(
                Polyline.from_BBox(bb, 0.254, this.selection_color),
            );

            this.renderer.polygon(Polygon.from_BBox(bb, this.selection_color));

            layer.graphics = this.renderer.end_layer();

            layer.graphics.composite_operation = "overlay";
        }

        this.draw();
    }

    /**
     * Groups of items drawn as colored boxes, independent of the selection.
     */
    public get highlights(): HighlightGroup[] {
        return this.#highlights;
    }

    public set highlights(groups: HighlightGroup[]) {
        this.#highlights = groups;

        if (this.layers) {
            this.paint_highlights();
            this.draw();
        }
    }

    /**
     * @returns the bounding boxes of the items with the given references in
     * the current document. Implemented by viewers that support highlights.
     */
    protected find_refs_bboxes(refs: RefQuery[]): BBox[] {
        return [];
    }

    /**
     * The label drawn for a highlight group on the current page.
     */
    protected highlight_label(group: HighlightGroup): string {
        return group.label;
    }

    protected paint_highlights() {
        const layer = this.layers.highlights;

        layer.clear();

        if (!this.#highlights.length) {
            return;
        }

        this.renderer.start_layer(layer.name);

        for (const group of this.#highlights) {
            const bboxes = this.find_refs_bboxes(group.refs);

            // Groups whose items are on another page aren't drawn.
            if (bboxes.length) {
                paint_highlight(
                    this.renderer,
                    bboxes,
                    group,
                    this.highlight_label(group),
                );
            }
        }

        layer.graphics = this.renderer.end_layer();
    }

    abstract zoom_to_page(): void;

    zoom_to_selection() {
        if (!this.selected) {
            return;
        }
        this.viewport.camera.bbox = this.selected.grow(10);
        this.draw();
    }

    /**
     * Zooms in (factor > 1) or out (factor < 1) around the center of the
     * view, within the limits of mouse zooming.
     */
    zoom_by(factor: number) {
        const camera = this.viewport.camera;
        camera.zoom = Math.min(190, Math.max(0.5, camera.zoom * factor));
        this.draw();
    }

    /**
     * Zooms to the items with the given references in the current document.
     * @returns false if none of them are in the current document.
     */
    zoom_to_refs(refs: RefQuery[]): boolean {
        const bboxes = this.find_refs_bboxes(refs);
        if (!bboxes.length) {
            return false;
        }
        this.viewport.camera.bbox = BBox.combine(bboxes).grow(10);
        this.draw();
        return true;
    }

    flip_view() {
        const flip = !this.viewport.camera.flipped;

        this.viewport.camera.flipped = flip;

        for (const layer of this.layers.in_order()) {
            if (layer.graphics) {
                layer.graphics.renderer.state.flipped = flip;
            }
        }

        // We need redraw some items because some items are not flippable
        // TODO: it re-paint all items and is inefficient
        this.paint();
        this.draw();
    }
}
