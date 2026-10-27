"""Pair a local extension origin using a user-visible, per-install secret."""

import hmac
import json
import re
import secrets
import threading
from pathlib import Path


class Pairing:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            try:
                with path.open("x", encoding="utf-8") as handle:
                    json.dump(
                        {"token": secrets.token_urlsafe(32), "origin": None}, handle
                    )
            except FileExistsError:
                pass
        self.config = json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def valid_origin(origin):
        return bool(re.fullmatch(r"chrome-extension://[a-p]{32}", origin))

    def authorize(self, origin, token):
        return (
            self.valid_origin(origin)
            and origin == self.config["origin"]
            and hmac.compare_digest(token, self.config["token"])
        )

    def pair(self, origin, token):
        with self.lock:
            if not self.valid_origin(origin) or not hmac.compare_digest(
                token, self.config["token"]
            ):
                return False
            if self.config["origin"] not in (None, origin):
                return False
            updated = dict(self.config, origin=origin)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(json.dumps(updated), encoding="utf-8")
            temporary.replace(self.path)
            self.config = updated
            return True
