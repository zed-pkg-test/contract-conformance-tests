from pathlib import Path
import tomllib
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ORES_OTEL_COMMIT = "4f9e7021b81339e44681632b4d86308cf113e54f"
ORES_OTEL_MANIFEST = (
    "https://raw.githubusercontent.com/ores-otel/ores.otel.log/"
    f"{ORES_OTEL_COMMIT}/.zpkg.toml"
)


class OresOtelZedDependencyTest(unittest.TestCase):
    def test_next_loggers_is_a_zed_dependency(self) -> None:
        manifest = tomllib.loads((ROOT / ".zpkg.toml").read_text(encoding="utf-8"))
        self.assertEqual(
            manifest["dependencies"]["oresoftware/next-loggers"],
            "^0.1.0",
        )

    def test_dependency_matches_immutable_upstream_package_identity(self) -> None:
        with urllib.request.urlopen(ORES_OTEL_MANIFEST, timeout=15) as response:
            upstream = tomllib.loads(response.read().decode("utf-8"))

        self.assertEqual(upstream["package"]["org"], "oresoftware")
        self.assertEqual(upstream["package"]["name"], "next-loggers")
        self.assertEqual(upstream["package"]["version"], "0.1.0")
        self.assertEqual(
            upstream["package"]["repository"]["url"],
            "https://github.com/ores-otel/ores.otel.log",
        )
        self.assertEqual(
            upstream["dependencies"]["ores-otel/ores-interfaces"],
            "^0.1.0",
        )


if __name__ == "__main__":
    unittest.main()
