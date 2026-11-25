"""Outbound gateways behind small interfaces (Strategy / Adapter): swap implementations via config."""

from __future__ import annotations

import json
import logging
import threading
import urllib.request
from typing import Protocol

log = logging.getLogger(__name__)


class SmsSender(Protocol):
    def send(self, phone: str, text: str) -> None: ...


class ConsoleSmsSender:
    """Used until a real SMS provider is configured: the code goes to the server log."""

    def send(self, phone: str, text: str) -> None:
        log.info("[sms] %s: %s", phone, text)


class RecordingSmsSender:
    """Test double."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send(self, phone: str, text: str) -> None:
        self.sent.append((phone, text))


class PushSender(Protocol):
    def send(self, token: str, title: str, body: str) -> None: ...


class NullPushSender:
    def send(self, token: str, title: str, body: str) -> None:
        return None


class ExpoPushSender:
    """Sends through Expo's push service, in the background so requests are never slowed down."""

    URL = "https://exp.host/--/api/v2/push/send"

    def send(self, token: str, title: str, body: str) -> None:
        payload = json.dumps({"to": token, "title": title, "body": body, "sound": "default"}).encode()
        threading.Thread(target=self._post, args=(payload,), daemon=True).start()

    def _post(self, payload: bytes) -> None:
        request = urllib.request.Request(self.URL, data=payload, headers={"content-type": "application/json"})
        try:
            urllib.request.urlopen(request, timeout=10).close()
        except Exception:
            log.exception("push failed")
