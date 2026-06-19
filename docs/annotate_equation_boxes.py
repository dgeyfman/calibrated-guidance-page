#!/usr/bin/env python3
"""
Draw boxes around parts of equation.png and save them to JSON for the CBG
animation.

Usage:
  python annotate_equation_boxes.py ./imgs/anim-1/equation.png ./imgs/anim-1/equation_boxes.json

Controls:
  - Choose a label and color at the top.
  - Left-click and drag on the equation to add a box.
  - Click an existing box to select it.
  - Backspace/Delete deletes the selected box.
  - Ctrl+Z removes the last box.
  - Ctrl+S saves.

Typical colors:
  - blue: likelihood/weight term
  - orange: denoising direction term
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tkinter as tk
from dataclasses import dataclass, asdict
from tkinter import messagebox, ttk

try:
    from PIL import Image, ImageTk
except ImportError:  # pragma: no cover
    print(
        "This script needs Pillow. Install it with: python -m pip install pillow",
        file=sys.stderr,
    )
    raise


COLOR_MAP = {
    "blue": "#2457ff",
    "orange": "#f57c00",
    "gray": "#5f6468",
}


@dataclass
class Box:
    label: str
    color: str
    x: int
    y: int
    w: int
    h: int


class BoxAnnotator:
    def __init__(self, root: tk.Tk, image_path: str, output_path: str) -> None:
        self.root = root
        self.image_path = image_path
        self.output_path = output_path

        self.image = Image.open(image_path).convert("RGBA")
        self.image_width, self.image_height = self.image.size

        max_display_width = 1120
        max_display_height = 700
        self.scale = min(
            1.0,
            max_display_width / max(1, self.image_width),
            max_display_height / max(1, self.image_height),
        )
        display_size = (
            max(1, int(round(self.image_width * self.scale))),
            max(1, int(round(self.image_height * self.scale))),
        )
        self.display_image = self.image.resize(display_size, Image.Resampling.LANCZOS)
        self.photo = ImageTk.PhotoImage(self.display_image)

        self.boxes: list[Box] = []
        self.selected_index: int | None = None
        self.drag_start: tuple[int, int] | None = None
        self.temp_rect_id: int | None = None

        self.label_var = tk.StringVar(value="weights")
        self.color_var = tk.StringVar(value="blue")

        self._build_ui(display_size)
        self._load_existing_boxes()
        self._draw_boxes()

    def _build_ui(self, display_size: tuple[int, int]) -> None:
        self.root.title("Equation box annotator")

        toolbar = ttk.Frame(self.root, padding=8)
        toolbar.pack(side=tk.TOP, fill=tk.X)

        ttk.Label(toolbar, text="Label").pack(side=tk.LEFT)
        label_entry = ttk.Entry(toolbar, textvariable=self.label_var, width=24)
        label_entry.pack(side=tk.LEFT, padx=(4, 12))

        ttk.Label(toolbar, text="Color").pack(side=tk.LEFT)
        color_choice = ttk.Combobox(
            toolbar,
            textvariable=self.color_var,
            values=("blue", "orange", "gray"),
            width=10,
            state="readonly",
        )
        color_choice.pack(side=tk.LEFT, padx=(4, 12))

        ttk.Button(toolbar, text="Delete selected", command=self.delete_selected).pack(side=tk.LEFT, padx=4)
        ttk.Button(toolbar, text="Undo last", command=self.undo_last).pack(side=tk.LEFT, padx=4)
        ttk.Button(toolbar, text="Clear", command=self.clear_boxes).pack(side=tk.LEFT, padx=4)
        ttk.Button(toolbar, text="Save", command=self.save).pack(side=tk.RIGHT, padx=4)

        self.status_var = tk.StringVar(value="Drag on the equation to add a box.")
        ttk.Label(self.root, textvariable=self.status_var, padding=(8, 0, 8, 8)).pack(side=tk.BOTTOM, fill=tk.X)

        self.canvas = tk.Canvas(
            self.root,
            width=display_size[0],
            height=display_size[1],
            background="white",
            highlightthickness=0,
        )
        self.canvas.pack(side=tk.TOP, padx=8, pady=(0, 8))
        self.canvas.create_image(0, 0, anchor=tk.NW, image=self.photo)

        self.canvas.bind("<ButtonPress-1>", self.on_mouse_down)
        self.canvas.bind("<B1-Motion>", self.on_mouse_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_mouse_up)
        self.root.bind("<Delete>", lambda _event: self.delete_selected())
        self.root.bind("<BackSpace>", lambda _event: self.delete_selected())
        self.root.bind("<Control-s>", lambda _event: self.save())
        self.root.bind("<Control-z>", lambda _event: self.undo_last())

    def _load_existing_boxes(self) -> None:
        if not os.path.exists(self.output_path):
            return

        try:
            with open(self.output_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:  # pragma: no cover
            messagebox.showwarning("Could not read existing JSON", str(exc))
            return

        raw_boxes = data.get("boxes", data if isinstance(data, list) else [])
        for raw in raw_boxes:
            try:
                width = raw.get("w", raw.get("width"))
                height = raw.get("h", raw.get("height"))
                self.boxes.append(
                    Box(
                        label=str(raw.get("label", raw.get("name", ""))),
                        color=str(raw.get("color", "blue")).lower(),
                        x=int(round(float(raw["x"]))),
                        y=int(round(float(raw["y"]))),
                        w=int(round(float(width))),
                        h=int(round(float(height))),
                    )
                )
            except Exception:
                continue

    def to_image_coords(self, canvas_x: float, canvas_y: float) -> tuple[int, int]:
        x = int(round(canvas_x / self.scale))
        y = int(round(canvas_y / self.scale))
        x = max(0, min(self.image_width, x))
        y = max(0, min(self.image_height, y))
        return x, y

    def to_canvas_coords(self, x: int, y: int) -> tuple[float, float]:
        return x * self.scale, y * self.scale

    def find_box_at(self, x: int, y: int) -> int | None:
        for index in range(len(self.boxes) - 1, -1, -1):
            box = self.boxes[index]
            if box.x <= x <= box.x + box.w and box.y <= y <= box.y + box.h:
                return index
        return None

    def on_mouse_down(self, event: tk.Event) -> None:
        image_x, image_y = self.to_image_coords(event.x, event.y)
        hit = self.find_box_at(image_x, image_y)
        if hit is not None:
            self.selected_index = hit
            self.drag_start = None
            self._draw_boxes()
            self.status_var.set(f"Selected box {hit + 1}. Press Delete to remove it.")
            return

        self.selected_index = None
        self.drag_start = (event.x, event.y)
        if self.temp_rect_id is not None:
            self.canvas.delete(self.temp_rect_id)
            self.temp_rect_id = None
        self._draw_boxes()

    def on_mouse_drag(self, event: tk.Event) -> None:
        if self.drag_start is None:
            return
        x0, y0 = self.drag_start
        if self.temp_rect_id is not None:
            self.canvas.delete(self.temp_rect_id)
        color = COLOR_MAP.get(self.color_var.get(), COLOR_MAP["blue"])
        self.temp_rect_id = self.canvas.create_rectangle(
            x0,
            y0,
            event.x,
            event.y,
            outline=color,
            width=2,
            dash=(6, 4),
            tags=("temp",),
        )

    def on_mouse_up(self, event: tk.Event) -> None:
        if self.drag_start is None:
            return

        x0, y0 = self.drag_start
        x1, y1 = event.x, event.y
        self.drag_start = None
        if self.temp_rect_id is not None:
            self.canvas.delete(self.temp_rect_id)
            self.temp_rect_id = None

        ix0, iy0 = self.to_image_coords(min(x0, x1), min(y0, y1))
        ix1, iy1 = self.to_image_coords(max(x0, x1), max(y0, y1))
        width = ix1 - ix0
        height = iy1 - iy0

        if width < 3 or height < 3:
            self._draw_boxes()
            return

        label = self.label_var.get().strip() or self.color_var.get().strip() or "box"
        color = self.color_var.get().strip().lower() or "blue"
        if color not in COLOR_MAP:
            color = "blue"

        self.boxes.append(Box(label=label, color=color, x=ix0, y=iy0, w=width, h=height))
        self.selected_index = len(self.boxes) - 1
        self.status_var.set(f"Added {color} box: {label}")
        self._draw_boxes()

    def _draw_boxes(self) -> None:
        self.canvas.delete("box")
        for index, box in enumerate(self.boxes):
            x0, y0 = self.to_canvas_coords(box.x, box.y)
            x1, y1 = self.to_canvas_coords(box.x + box.w, box.y + box.h)
            color = COLOR_MAP.get(box.color, COLOR_MAP["blue"])
            width = 4 if index == self.selected_index else 2
            self.canvas.create_rectangle(x0, y0, x1, y1, outline=color, width=width, tags=("box",))
            text_y = max(8, y0 - 10)
            self.canvas.create_text(
                x0,
                text_y,
                anchor=tk.W,
                text=f"{index + 1}: {box.label}",
                fill=color,
                font=("TkDefaultFont", 9, "bold"),
                tags=("box",),
            )

    def delete_selected(self) -> None:
        if self.selected_index is None:
            self.status_var.set("No box selected.")
            return
        deleted = self.boxes.pop(self.selected_index)
        self.selected_index = None
        self.status_var.set(f"Deleted box: {deleted.label}")
        self._draw_boxes()

    def undo_last(self) -> None:
        if not self.boxes:
            self.status_var.set("No boxes to undo.")
            return
        deleted = self.boxes.pop()
        self.selected_index = None
        self.status_var.set(f"Removed last box: {deleted.label}")
        self._draw_boxes()

    def clear_boxes(self) -> None:
        if not self.boxes:
            return
        if messagebox.askyesno("Clear boxes", "Remove all boxes?"):
            self.boxes.clear()
            self.selected_index = None
            self.status_var.set("Cleared all boxes.")
            self._draw_boxes()

    def save(self) -> None:
        os.makedirs(os.path.dirname(os.path.abspath(self.output_path)), exist_ok=True)
        data = {
            "image": os.path.basename(self.image_path),
            "imageWidth": self.image_width,
            "imageHeight": self.image_height,
            "boxes": [asdict(box) for box in self.boxes],
        }
        with open(self.output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        self.status_var.set(f"Saved {len(self.boxes)} boxes to {self.output_path}")
        messagebox.showinfo("Saved", f"Saved {len(self.boxes)} boxes to:\n{self.output_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Annotate equation image boxes for the CBG animation.")
    parser.add_argument("image", help="Path to equation.png")
    parser.add_argument(
        "output",
        nargs="?",
        default="equation_boxes.json",
        help="Output JSON path. Default: equation_boxes.json",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = tk.Tk()
    BoxAnnotator(root, args.image, args.output)
    root.mainloop()


if __name__ == "__main__":
    main()
