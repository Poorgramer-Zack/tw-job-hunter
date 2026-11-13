import json
from pathlib import Path

MANIFEST = Path(__file__).resolve().parent.parent / ".claude-plugin" / "plugin.json"


def test_tavily_key_is_optional_sensitive_user_config():
    cfg = json.loads(MANIFEST.read_text(encoding="utf-8"))["userConfig"]["tavily_api_key"]
    assert cfg["type"] == "string" and cfg["sensitive"] is True and cfg["default"] == ""
    assert not cfg.get("required")
    assert "app.tavily.com" in cfg["description"]


def test_mcp_server_receives_key_through_user_config():
    server = json.loads(MANIFEST.read_text(encoding="utf-8"))["mcpServers"]["tw-job-hunter"]
    assert server["env"]["TAVILY_API_KEY"] == "${user_config.tavily_api_key}"
    assert "${CLAUDE_PLUGIN_ROOT}" in " ".join(server["args"])


def test_manifest_never_contains_a_real_key():
    assert "tvly-" not in MANIFEST.read_text(encoding="utf-8")
