"""Check the bundled PDF font using the uv-managed development dependency."""

from pathlib import Path

from fontTools.ttLib import TTFont


FONT = Path(__file__).resolve().parents[1] / "public/fonts/NotoSansSC-Regular.ttf"


def main() -> None:
    with TTFont(FONT, lazy=True) as font:
        if "fvar" in font:
            raise SystemExit("PDF font must be a static TTF")
        cmap = font.getBestCmap() or {}
        missing = [character for character in "翻译测试" if ord(character) not in cmap]
        if missing:
            raise SystemExit(f"PDF font is missing glyphs: {''.join(missing)}")
    print(f"Font OK: {FONT.name} ({FONT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
