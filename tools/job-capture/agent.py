"""CLI adapter with bounded execution and process-tree cancellation."""

import os
import subprocess
import time


class AgentStopped(Exception):
    pass


def stop(process):
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
    if process.poll() is None:
        process.kill()
    process.communicate()


def run_agent(command, prompt, cwd, env, cancelled, timeout):
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=cwd,
        env=env,
    )
    deadline = time.monotonic() + timeout
    first = True
    try:
        while True:
            if cancelled():
                raise AgentStopped("Run cancelled by the user.")
            if time.monotonic() >= deadline:
                raise subprocess.TimeoutExpired(command, timeout)
            try:
                output, error = process.communicate(
                    input=prompt if first else None, timeout=1
                )
                return subprocess.CompletedProcess(
                    command, process.returncode, output, error
                )
            except subprocess.TimeoutExpired:
                first = False
    finally:
        if process.poll() is None:
            stop(process)
