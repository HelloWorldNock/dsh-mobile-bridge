"""Build launcher icons from the supplied chibi illustration.

The source has a flat white background. Flood fill from the four corners to
transparent, crop to the character, then render an adaptive foreground plus
legacy raster mipmaps.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "绘制图标.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"


def cutout() -> Image.Image:
    image = Image.open(SOURCE).convert("RGBA")
    width, height = image.size
    for seed in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        ImageDraw.floodfill(image, seed, (255, 255, 255, 0), thresh=26)
    box = image.getchannel("A").getbbox()
    if box is None:
        raise SystemExit("no opaque pixels after cutout")
    return image.crop(box)


def fit(image: Image.Image, size: int) -> Image.Image:
    scale = min(size / image.width, size / image.height)
    target = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(target, Image.LANCZOS)


def main() -> None:
    subject = cutout()
    foreground = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    fitted = fit(subject, 372)
    foreground.alpha_composite(
        fitted, ((432 - fitted.width) // 2, (432 - fitted.height) // 2)
    )
    drawable = RES / "drawable-nodpi"
    drawable.mkdir(parents=True, exist_ok=True)
    foreground.save(drawable / "ic_launcher_foreground.png", optimize=True)

    background = (232, 237, 255, 255)  # #E8EDFF, same as ic_launcher_background
    for density, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        canvas = Image.new("RGBA", (size, size), background)
        icon = fit(subject, round(size * 0.92))
        canvas.alpha_composite(icon, ((size - icon.width) // 2, (size - icon.height) // 2))
        canvas.save(folder / "ic_launcher.png", optimize=True)
        canvas.save(folder / "ic_launcher_round.png", optimize=True)

    print("wrote adaptive foreground and mipmaps")


if __name__ == "__main__":
    main()
