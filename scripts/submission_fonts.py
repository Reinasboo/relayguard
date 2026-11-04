"""Create static Manrope instances for PDF and video renderers."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


def font_paths(root: Path):
    source = root / "public/fonts/manrope.ttf"
    directory = root / "tmp/submission-fonts"
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    for weight, name in [(400, "regular"), (600, "semibold")]:
        target = directory / f"manrope-{name}.ttf"
        if not target.exists() or target.stat().st_mtime < max(source.stat().st_mtime, Path(__file__).stat().st_mtime):
            font = TTFont(source)
            instantiateVariableFont(font, {"wght": weight}, inplace=True)
            # PDF renderers identify embedded faces by their PostScript name.
            # Give the two instances distinct names instead of retaining the
            # variable font's default ExtraLight name for both weights.
            style = "Regular" if weight == 400 else "SemiBold"
            names = {1: "Manrope", 2: style, 4: f"Manrope {style}", 6: f"Manrope-{style}"}
            for record in font["name"].names:
                if record.nameID in names:
                    record.string = names[record.nameID].encode(record.getEncoding())
            font.save(target)
            font.close()
        paths.append(target)
    return paths
