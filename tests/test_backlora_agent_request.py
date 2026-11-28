import json
from pathlib import Path
from runpy import run_path
from tempfile import TemporaryDirectory
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/backlora-agent-request.py"
CLIENT = run_path(str(SCRIPT))


class AgentRequestTest(unittest.TestCase):
    def test_all_requests_read_the_exact_key_from_the_saved_prompt(self):
        key = "sk_this_is_a_synthetic_test_key"
        origin = "https://backlora.example.test"
        prompt = (
            f"- API 基础地址（BASE_URL）：`{origin}`\n"
            f"- API Key（apiKey）：`{key}`"
        )
        with TemporaryDirectory() as directory:
            config = Path(directory, "automation.toml")
            config.write_text("prompt = " + json.dumps(prompt, ensure_ascii=False))
            credentials = CLIENT["read_config"](config)

        get = CLIENT["request_for"](*credentials, "GET", "/api/websites/project")
        post = CLIENT["request_for"](
            *credentials, "POST", "/api/v1/backlink-tasks/start", {"worker_id": "one"}
        )
        self.assertEqual(get.headers["Authorization"], f"Bearer {key}")
        self.assertEqual(post.headers["Authorization"], get.headers["Authorization"])
        self.assertEqual(json.loads(post.data), {"worker_id": "one"})

    def test_routes_and_redirects_cannot_forward_the_credential(self):
        credentials = ("https://backlora.example.test", "sk_fixture")
        with self.assertRaises(ValueError):
            CLIENT["request_for"](*credentials, "GET", "//other.example.test/")
        with self.assertRaises(ValueError):
            CLIENT["request_for"](*credentials, "POST", "/api/websites/project", {})
        redirect = CLIENT["NoRedirect"]()
        self.assertIsNone(
            redirect.redirect_request(None, None, 302, "", {}, "https://other.example.test/")
        )

    def test_duplicate_or_missing_key_entries_fail_before_making_a_request(self):
        with TemporaryDirectory() as directory:
            file = Path(directory, "automation.toml")
            for key_lines in ("", "\n- API Key（apiKey）：`sk_one`\n- API Key（apiKey）：`sk_two`"):
                prompt = "- API 基础地址（BASE_URL）：`https://backlora.example.test`" + key_lines
                file.write_text("prompt = " + json.dumps(prompt, ensure_ascii=False))
                with self.assertRaises(ValueError):
                    CLIENT["read_config"](file)


if __name__ == "__main__":
    unittest.main()
