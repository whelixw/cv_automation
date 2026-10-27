"""Recovery, idempotency and pairing boundaries without real agent execution."""
# ruff: noqa: PT009, PT027

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

with patch.object(sys, "path", [str(Path(__file__).resolve().parents[1]), *sys.path]):
    import agent
    from security import Pairing
    from store import Store


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "state.sqlite3"
        self.store = Store(self.path)

    def test_restart_recovers_without_losing_results(self):
        first, _ = self.store.start("jobs/one", "analyze")
        self.store.update(first["id"], status="complete", result="Reviewed emphasis")
        second, _ = self.store.start("jobs/two", "analyze")
        restarted = Store(self.path)
        self.assertEqual(restarted.recover(), 1)
        self.assertEqual(restarted.task(first["id"])["result"], "Reviewed emphasis")
        self.assertEqual(restarted.task(second["id"])["status"], "interrupted")
        self.assertEqual(len(restarted.events(second["id"])), 2)

    def test_idempotency_and_active_run_exclusion(self):
        first, created = self.store.start(
            "jobs/one", "analyze", request_id="request-one"
        )
        self.assertTrue(created)
        again, created = self.store.start(
            "jobs/one", "analyze", request_id="request-one"
        )
        self.assertFalse(created)
        self.assertEqual(first["id"], again["id"])
        with self.assertRaises(ValueError):
            self.store.start("jobs/other", "analyze", request_id="request-one")
        with self.assertRaises(ValueError):
            self.store.start("jobs/one", "generate")
        self.store.update(first["id"], status="complete")
        generated, _ = self.store.start("jobs/one", "generate")
        self.assertEqual(generated["phase"], "generate")

    def test_unreviewed_generation_rejected_and_backup_preserves_data(self):
        with self.assertRaises(ValueError):
            self.store.start("jobs/one", "generate")
        self.store.save_application({"directory": "jobs/one", "title": "Analyst"})
        backup = self.path.with_name("backup.sqlite3")
        self.store.backup(backup)
        self.assertEqual(Store(backup).application("jobs/one")["title"], "Analyst")

    def test_pairing_requires_secret_and_exact_extension_origin(self):
        path = self.path.with_name("connection.json")
        pairing = Pairing(path)
        origin = "chrome-extension://" + "a" * 32
        token = pairing.config["token"]
        self.assertFalse(pairing.pair("https://example.test", token))
        self.assertFalse(pairing.pair(origin, "wrong"))
        self.assertTrue(pairing.pair(origin, token))
        restarted = Pairing(path)
        self.assertTrue(restarted.authorize(origin, token))
        self.assertFalse(restarted.authorize(origin + "/", token))
        self.assertFalse(restarted.pair("chrome-extension://" + "b" * 32, token))

    def test_cancellation_stops_running_agent(self):
        process = Mock()
        process.poll.return_value = None
        with (
            patch.object(agent.subprocess, "Popen", return_value=process),
            patch.object(agent, "stop") as stop,
        ):
            with self.assertRaises(agent.AgentStopped):
                agent.run_agent(
                    ["fake-agent"], "prompt", self.path.parent, {}, lambda: True, 30
                )
            stop.assert_called_once_with(process)
