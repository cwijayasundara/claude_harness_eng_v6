"""Generate matrices.pptx — Telemetry & Team Velocity deck.
Design: 16:9, slate-900 bg, sky-400 accent, Calibri.
"""

from pptx import Presentation
from pptx.util import Inches

from pptx_util.deck_primitives import SW, SH, set_total_slides
from pptx_util.deck_slides import ALL as SLIDES_1_6
from pptx_util.deck_slides_continued import ALL as SLIDES_7_11
from pptx_util.deck_slides_phase import ALL as SLIDES_PHASE


def main():
    all_slides = SLIDES_1_6 + SLIDES_7_11 + SLIDES_PHASE
    set_total_slides(len(all_slides))
    p = Presentation()
    p.slide_width = Inches(SW)
    p.slide_height = Inches(SH)
    for fn in all_slides:
        fn(p)
    p.save("matrices.pptx")
    print(f"wrote matrices.pptx ({len(all_slides)} slides)")


if __name__ == "__main__":
    main()
