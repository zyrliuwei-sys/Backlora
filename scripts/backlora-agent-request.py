"""Call the Backlora API with the credential saved in a Codex automation."""

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

SETTING = {
    "origin": re.compile(r"^- API 基础地址（BASE_URL）：`([^`\r\n]+)`$", re.M),
    "key": re.compile(r"^- API Key（apiKey）：`(sk_[A-Za-z0-9_-]+)`$", re.M),
}
ID = r"[A-Za-z0-9_-]+"
GET_PATH = re.compile(
    rf"/api/(?:websites/{ID}(?:/badge-connection)?|v1/backlink-tasks/{ID})"
)
POST_PATH = re.compile(
    rf"/api/v1/backlink-tasks/(?:start|{ID}/"
    r"(?:heartbeat|result|google-login|verification-email|badge))"
)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_config(path):
    with path.open("rb") as file:
        prompt = tomllib.load(file).get("prompt", "")
    values = {name: pattern.findall(prompt) for name, pattern in SETTING.items()}
    if any(len(matches) != 1 for matches in values.values()):
        raise ValueError("Missing or ambiguous Backlora settings in the automation")

    origin = values["origin"][0].rstrip("/")
    parsed = urlsplit(origin)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Backlora base URL must be an HTTPS origin")
    return origin, values["key"][0]


def request_for(origin, key, method, path, body=None):
    routes = GET_PATH if method == "GET" else POST_PATH
    if not routes.fullmatch(path):
        raise ValueError("Unsupported Backlora API route")
    headers = {
        "Authorization": f"Bearer {key}",
        "User-Agent": "Backlora-Agent/1.0",
        "Accept": "application/json",
    }
    if method == "POST":
        if not isinstance(body, dict):
            raise ValueError("POST requires a JSON object on stdin")
        headers["Content-Type"] = "application/json"
    return Request(
        origin + path,
        data=json.dumps(body).encode("utf-8") if method == "POST" else None,
        headers=headers,
        method=method,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("automation_id")
    parser.add_argument("method", choices=("GET", "POST"))
    parser.add_argument("path")
    args = parser.parse_args()
    if not re.fullmatch(ID, args.automation_id):
        parser.error("Invalid automation ID")
    config = (
        Path.home() / ".codex" / "automations" / args.automation_id / "automation.toml"
    )
    try:
        origin, key = read_config(config)
        body = json.load(sys.stdin) if args.method == "POST" else None
        request = request_for(origin, key, args.method, args.path, body)
    except (OSError, ValueError, TypeError):
        parser.error("Cannot read the automation’s Backlora settings, route, or JSON input")

    try:
        with build_opener(NoRedirect()).open(request, timeout=25) as response:
            sys.stdout.buffer.write(response.read())
    except HTTPError as error:
        sys.stdout.buffer.write(error.read())
        print(f"Backlora HTTP {error.code}", file=sys.stderr)
        return 1
    except (URLError, TimeoutError, OSError):
        print("Backlora request did not complete", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
