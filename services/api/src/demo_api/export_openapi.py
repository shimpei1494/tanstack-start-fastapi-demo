import json
from pathlib import Path

from demo_api.main import app


def main() -> None:
    destination = Path(__file__).resolve().parents[2] / "openapi.json"
    destination.write_text(
        json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    )
    print(f"Exported {destination.name}")


if __name__ == "__main__":
    main()
