"""Tests of the web app: the page renders, with and without a URL prefix."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app  # noqa: E402


class AppTest(unittest.TestCase):
    prefix = ""

    def setUp(self):
        self.client = create_app({"TESTING": True, "PREFIX": self.prefix}).test_client()

    def test_home(self):
        resp = self.client.get(self.prefix + "/")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        self.assertIn("Hvernig eignast ég hús?", html)
        self.assertIn(f'src="{self.prefix}/static/calc.js"', html)
        self.assertIn(f'src="{self.prefix}/static/app.js"', html)

    def test_static(self):
        for name in ("calc.js", "app.js", "favicon.svg"):
            resp = self.client.get(f"{self.prefix}/static/{name}")
            self.assertEqual(resp.status_code, 200, name)
            resp.close()


class PrefixedAppTest(AppTest):
    prefix = "/hus"


if __name__ == "__main__":
    unittest.main()
