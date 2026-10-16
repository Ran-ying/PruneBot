from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1] / "Resources"
SOURCE = ROOT / "brune.png"
CANVAS_SIZE = (720, 1280)
MAX_ART_SIZE = (680, 1180)
ALPHA_CUTOFF = 8


def prepare_art() -> Image.Image:
    art = Image.open(SOURCE).convert("RGBA")
    alpha = art.getchannel("A")
    visible_mask = alpha.point(lambda value: 255 if value >= ALPHA_CUTOFF else 0)
    bbox = visible_mask.getbbox()
    if bbox is None:
        raise ValueError("brune.png has no visible pixels")

    # Remove near-transparent edge noise before compositing.
    cleaned_alpha = alpha.point(lambda value: 0 if value < ALPHA_CUTOFF else value)
    art.putalpha(cleaned_alpha)
    art = art.crop(bbox)

    scale = min(MAX_ART_SIZE[0] / art.width, MAX_ART_SIZE[1] / art.height)
    output_size = (round(art.width * scale), round(art.height * scale))

    # Resize premultiplied RGBA to avoid colored fringes from transparent RGB data.
    return art.convert("RGBa").resize(output_size, Image.Resampling.LANCZOS).convert("RGBA")


def render(name: str, background: tuple[int, int, int], art: Image.Image) -> None:
    canvas = Image.new("RGBA", CANVAS_SIZE, (*background, 255))
    position = ((CANVAS_SIZE[0] - art.width) // 2, (CANVAS_SIZE[1] - art.height) // 2)
    canvas.alpha_composite(art, position)

    rgb = canvas.convert("RGB")
    rgb.save(ROOT / f"brune-{name}.png", format="PNG", optimize=True)
    rgb.save(
        ROOT / f"brune-{name}.jpg",
        format="JPEG",
        quality=95,
        subsampling=0,
        optimize=True,
    )


def main() -> None:
    art = prepare_art()
    render("day", (250, 250, 247), art)
    render("night", (217, 217, 222), art)


if __name__ == "__main__":
    main()
