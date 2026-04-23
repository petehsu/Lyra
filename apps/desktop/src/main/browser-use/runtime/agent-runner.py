import json
import sys


def _emit(payload):
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def main():
    _emit({
        "ok": False,
        "summary": (
            "browser_use.agent.run is disabled in this Lyra vendoring because "
            "the imported runtime depends on provider-specific private bindings."
        ),
        "steps": [],
    })


if __name__ == "__main__":
    main()
