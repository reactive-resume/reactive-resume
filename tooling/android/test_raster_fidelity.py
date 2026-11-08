"""Regression proof: raster coverage cannot mask native geometry or changed fixture pixels."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from PIL import Image

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("prepare", HERE / "prepare-fidelity.py")
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class RasterFidelityTest(unittest.TestCase):
    def run_compare(self, mutation=None):
        box = dict(x=10, y=20, w=100, h=140)
        design = dict(id="B1-Test", elements=[
            dict(n=1, depth=1, component="Page", box=box),
            dict(n=2, depth=2, text="Baked text", box=box),
            dict(n=3, depth=1, text="Native text", box=dict(x=10,y=180,w=60,h=24)),
        ])
        prepare.annotate(design, 1, "fixture.png", Image.new("RGBA", (2, 3), "red"))
        actual = dict(elements=[dict(component="Page", **box, raster=design["elements"][0]["raster"].copy()),
            dict(text="Native text", x=10,y=180,w=60,h=24)])
        if mutation:
            mutation(actual)
        with tempfile.TemporaryDirectory() as tmp:
            d, a = Path(tmp)/"design.json", Path(tmp)/"actual.json"
            d.write_text(json.dumps(design)); a.write_text(json.dumps(actual))
            return subprocess.run(["python3", str(HERE/"layout_compare.py"), str(d), str(a)], capture_output=True, text=True)

    def test_exact_pixels_cover_only_raster_descendants(self):
        result = self.run_compare()
        self.assertEqual(0, result.returncode, result.stdout)
        self.assertIn("1 exact rasters cover 1 internals", result.stdout)

    def test_changed_pixel_hash_fails(self):
        self.assertNotEqual(0, self.run_compare(lambda a: a["elements"][0]["raster"].update(rgbaSha256="wrong")).returncode)

    def test_missing_evidence_fails(self):
        self.assertNotEqual(0, self.run_compare(lambda a: a["elements"][0].pop("raster")).returncode)

    def test_changed_decoded_dimensions_fail(self):
        self.assertNotEqual(0, self.run_compare(lambda a: a["elements"][0]["raster"].update(width=4)).returncode)

    def test_moved_image_fails(self):
        self.assertNotEqual(0, self.run_compare(lambda a: a["elements"][0].update(x=12)).returncode)

    def test_native_text_still_measured(self):
        self.assertNotEqual(0, self.run_compare(lambda a: a["elements"][1].update(y=182)).returncode)

    def test_annotation_idempotent(self):
        layout = dict(elements=[dict(n=1,depth=1),dict(n=2,depth=2),dict(n=3,depth=1)])
        image = Image.new("RGBA", (1,1), "red")
        first = json.dumps(prepare.annotate(layout,1,"fixture.png",image))
        self.assertEqual(first, json.dumps(prepare.annotate(layout,1,"fixture.png",image)))
        self.assertNotIn("rasterParent", layout["elements"][2])


if __name__ == "__main__":
    unittest.main()
