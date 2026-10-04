"""
Generates the OrcaRouter integration evidence under orca-evidence/.

The independent verifier applies the patch to a fresh checkout and runs this script. It builds the
real production bundle, starts the real server against a real PostgreSQL, drives the real web UI in
Chromium, and writes manifest.json with the sha256 of every screenshot. Nothing here is a stand-in
page: the model list in the dropdowns is fetched by the shipped server code path
(packages/api/src/features/ai/orcarouter/discovery.ts) with the account's own OrcaRouter key, and the
screenshots are the project's own settings page and assistant composer.

Only counts and capability names are printed; the API key is never written to an artifact or a log.
"""

import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[2]
OUT = REPO / "orca-evidence"
CATALOG_URL = "https://api.orcarouter.ai/v1/models?capability=chat"
CHAT_MODEL_ID = "deepseek/deepseek-v4-pro"
PNPM = ["npx", "--yes", "pnpm@12.9.1"]
PORT_RANGE = range(33100, 33200)


def log(message: str) -> None:
    print(f"[orca-evidence] {message}", flush=True)


def base_env(**extra: str) -> dict[str, str]:
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"),
        "HOME": os.environ.get("HOME", str(pathlib.Path.home())),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "CI": "1",
    }
    env.update(extra)
    return env


def run(argv: list[str], cwd: pathlib.Path, env: dict[str, str], timeout: int = 900) -> str:
    result = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise SystemExit(f"command failed ({result.returncode}): {' '.join(argv)}\n{result.stdout[-4000:]}\n{result.stderr[-4000:]}")
    return result.stdout


def open_port() -> int:
    import socket

    for port in PORT_RANGE:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
        return port
    raise SystemExit("no free port for the evidence installation")


def wait_for_health(url: str, process: subprocess.Popen, timeout_seconds: int = 90) -> None:
    deadline = time.monotonic() + timeout_seconds
    last: str | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise SystemExit(f"server exited early with {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status == 200:
                    return
                last = f"status {response.status}"
        except Exception as error:  # noqa: BLE001 - the loop only needs to know it is not ready yet
            last = str(error)
        time.sleep(1)
    raise SystemExit(f"server did not become healthy at {url}: {last}")


def find_pg_bin() -> pathlib.Path:
    candidates = []
    import site

    for root in (site.getusersitepackages(), *site.getsitepackages()):
        candidates.append(pathlib.Path(root) / "pgserver" / "pginstall" / "bin")
    for entry in sys.path:
        candidates.append(pathlib.Path(entry) / "pgserver" / "pginstall" / "bin")
    for candidate in candidates:
        if (candidate / "postgres").exists():
            return candidate
    raise SystemExit("pgserver binaries not found; setup must install the pgserver wheel")


def start_database() -> tuple[subprocess.Popen, str, pathlib.Path]:
    pg_bin = find_pg_bin()
    root = pathlib.Path(tempfile.mkdtemp(prefix="orca-pg-"))
    data = root / "data"
    sock = root / "socket"
    sock.mkdir(parents=True)
    run(
        [str(pg_bin / "initdb"), "--auth=trust", "--auth-local=trust", "--encoding=utf8", "-U", "postgres", "-D", str(data)],
        cwd=root,
        env=base_env(),
    )
    port = open_port()
    process = subprocess.Popen(
        [str(pg_bin / "postgres"), "-D", str(data), "-h", "127.0.0.1", "-p", str(port), "-k", str(sock)],
        cwd=root,
        env=base_env(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        probe = subprocess.run(
            [str(pg_bin / "psql"), f"postgresql://postgres@127.0.0.1:{port}/postgres", "-c", "select 1"],
            capture_output=True,
            text=True,
        )
        if probe.returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise SystemExit("postgres did not start")
    return process, f"postgresql://postgres@127.0.0.1:{port}/postgres", root


def build() -> None:
    if os.environ.get("ORCA_EVIDENCE_SKIP_BUILD"):
        log("skipping build (ORCA_EVIDENCE_SKIP_BUILD)")
        return
    log("building apps/web and apps/server")
    run([*PNPM, "--filter", "web", "--filter", "server", "build"], cwd=REPO, env=base_env())


def catalog_counts(api_key: str) -> tuple[int, int]:
    request = urllib.request.Request(CATALOG_URL, headers={"Authorization": f"Bearer {api_key}"})
    payload = json.loads(urllib.request.urlopen(request, timeout=30).read())
    rows = payload.get("data") or []
    image = [row for row in rows if "image" in ((row.get("architecture") or {}).get("input_modalities") or [])]
    return len(rows), len(image)


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def panel_metrics(page, trigger) -> dict:
    """Measure the open popup's own rendered container and its alignment with the trigger."""
    panel = page.locator('[data-slot="combobox-content"]:visible').last
    panel.wait_for(state="visible")
    rectangle = panel.evaluate(
        """(node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return {
                border: parseFloat(style.borderTopWidth) || 0,
                background: style.backgroundColor,
                right: rect.right,
            };
        }"""
    )
    trigger_right = trigger.evaluate("(node) => node.getBoundingClientRect().right")
    alpha = 1.0
    match = re.search(r"rgba?\(([^)]+)\)", rectangle["background"] or "")
    if match:
        parts = [part.strip() for part in match.group(1).split(",")]
        if len(parts) == 4:
            alpha = float(parts[3])
    return {
        "opaque_background": alpha >= 1.0,
        "visible_border": rectangle["border"] > 0,
        "trigger_panel_right_delta": round(rectangle["right"] - trigger_right),
    }


def click_option(page, model_id: str) -> None:
    options = page.locator('[role="option"]')
    for index in range(options.count()):
        option = options.nth(index)
        label = option.inner_text().split(" · ")[0].strip()
        if label == model_id:
            option.click()
            return
    raise SystemExit(f"model {model_id} was not offered by the selector")


def main() -> None:
    api_key = os.environ.get("ORCAROUTER_API_KEY")
    if not api_key:
        raise SystemExit("ORCAROUTER_API_KEY is required to produce live evidence")
    OUT.mkdir(exist_ok=True)

    total, image = catalog_counts(api_key)
    log(f"live chat catalog: {total} models, {image} with image input")

    build()
    database, database_url, database_root = start_database()
    server = None
    browser = None
    try:
        port = open_port()
        health = f"http://127.0.0.1:{port}/api/health"
        storage = pathlib.Path(tempfile.mkdtemp(prefix="orca-storage-"))
        server = subprocess.Popen(
            ["node", "apps/server/dist/index.mjs"],
            cwd=REPO,
            env=base_env(
                NODE_ENV="production",
                PORT=str(port),
                APP_URL=f"http://127.0.0.1:{port}",
                DATABASE_URL=database_url,
                AUTH_SECRET="orca-evidence-auth-secret-0000000000000000",
                ENCRYPTION_SECRET="orca-evidence-encryption-secret-00000000",
                STORAGE_BACKEND="local",
                LOCAL_STORAGE_PATH=str(storage),
                FLAG_DISABLE_SIGNUPS="false",
                FLAG_DISABLE_EMAIL_AUTH="false",
                FLAG_DISABLE_API_RATE_LIMIT="true",
            ),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        wait_for_health(health, server)
        log(f"server healthy on {port}")

        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            launch: dict = {"args": ["--no-sandbox"]}
            if pathlib.Path("/usr/bin/chromium").exists():
                launch["executable_path"] = "/usr/bin/chromium"
            browser = playwright.chromium.launch(**launch)
            base = f"http://127.0.0.1:{port}"
            context = browser.new_context(base_url=base, viewport={"width": 1280, "height": 900})
            email = "orca-evidence@example.com"
            signup = context.request.post(
                "/api/auth/sign-up/email",
                headers={"origin": base, "referer": f"{base}/auth/register"},
                data={
                    "name": "Orca Evidence",
                    "email": email,
                    "password": "OrcaEvidence!2345",
                    "username": "orcaevidence",
                    "displayUsername": "orcaevidence",
                    "callbackURL": "/dashboard",
                },
            )
            if not signup.ok:
                signin = context.request.post(
                    "/api/auth/sign-in/email",
                    headers={"origin": base, "referer": f"{base}/auth/login"},
                    data={"email": email, "password": "OrcaEvidence!2345"},
                )
                assert signin.ok, f"sign-in failed: {signin.status}"
            page = context.new_page()

            page.goto("/dashboard/settings/ai", wait_until="networkidle")
            page.get_by_role("button", name="Add AI provider").click()
            page.wait_for_timeout(400)
            # The combobox popup is itself `role=dialog`, so scope to the provider dialog by name.
            dialog = page.get_by_role("dialog", name="Add provider")

            # 1. Both ways in, on OrcaRouter's own configuration surface.
            dialog.get_by_role("combobox").first.click()
            page.wait_for_timeout(400)
            page.get_by_role("option", name="OrcaRouter", exact=True).click()
            page.wait_for_timeout(300)
            assert dialog.get_by_test_id("orca-method-api-key").is_visible()
            assert dialog.get_by_test_id("orca-method-pkce").is_visible()
            dialog.get_by_test_id("orca-method-api-key").click()
            page.wait_for_timeout(150)
            api_key_input = dialog.get_by_test_id("orca-api-key-input")
            assert api_key_input.is_visible()
            assert api_key_input.get_attribute("type") == "password", "the key field is not masked"
            dialog.get_by_test_id("orca-method-pkce").click()
            page.wait_for_timeout(200)
            assert dialog.get_by_test_id("orca-connect-start").is_visible()
            dialog.get_by_test_id("orca-method-api-key").click()
            page.wait_for_timeout(150)
            api_key_input.fill(api_key)
            page.wait_for_timeout(200)
            controls_enabled = dialog.get_by_role("button", name="Save key").is_enabled()
            assert controls_enabled, "the API key form is not usable"
            page.screenshot(path=str(OUT / "auth-methods.png"))

            # 2. Save the key, then open the model control over the live catalog.
            dialog.get_by_role("button", name="Save key").click()
            selector = page.get_by_test_id("orca-model-selector")
            selector.wait_for(state="visible", timeout=30_000)
            page.wait_for_timeout(1_500)
            assert page.get_by_test_id("orca-catalog-degraded").count() == 0, "catalog fell back to the seed"
            trigger = selector.locator('[data-slot="combobox-trigger"]').first
            trigger.click()
            page.wait_for_timeout(1_200)
            options = page.locator('[role="option"]')
            rendered = options.count()
            assert rendered == total, f"text selector offered {rendered} of {total} live models"
            page.screenshot(path=str(OUT / "text-model-dropdown.png"))
            text_metrics = panel_metrics(page, trigger)
            click_option(page, CHAT_MODEL_ID)
            page.wait_for_timeout(300)

            # 3. Test the connection with the model the selector offered; the dialog closes on success.
            dialog.get_by_role("button", name="Save and test").click()
            dialog.wait_for(state="hidden", timeout=90_000)
            log("provider saved and connection test passed")

            # 4. A real resume, the assistant composer, and an image attachment.
            page.goto("/dashboard", wait_until="networkidle")
            page.get_by_role("button", name=re.compile("^New")).first.click()
            page.wait_for_timeout(700)
            page.get_by_role("button", name="Start blank").click()
            page.wait_for_timeout(3_000)
            page.locator("[data-assistant-toggle]").click()
            page.wait_for_timeout(3_000)
            composer = page.get_by_test_id("orca-composer-model")
            composer.wait_for(state="visible", timeout=30_000)
            composer_trigger = composer.locator('[data-slot="combobox-trigger"]').first
            composer_trigger.click()
            page.wait_for_timeout(1_200)
            assert page.locator('[role="option"]').count() == total

            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
            page.locator('input[type="file"]').first.set_input_files(
                {"name": "photo.png", "mimeType": "image/png", "buffer": b"\x89PNG\r\n\x1a\n" + b"0" * 64}
            )
            page.wait_for_timeout(3_500)
            composer_trigger.click()
            page.wait_for_timeout(1_500)
            narrowed = page.locator('[role="option"]').count()
            assert narrowed == image, f"image attachment offered {narrowed} of {image} capable models"
            page.screenshot(path=str(OUT / "multimodal-model-dropdown.png"))
            multimodal_metrics = panel_metrics(page, composer_trigger)

            manifest = {
                "automation": {
                    "framework": "playwright",
                    "passed": True,
                    "catalog_source": CATALOG_URL,
                    "catalog_model_count": total,
                    "image_model_count": image,
                },
                "artifacts": [
                    {
                        "kind": "auth-methods",
                        "path": "auth-methods.png",
                        "sha256": sha256(OUT / "auth-methods.png"),
                        "ui": {
                            "api_key_visible": True,
                            "pkce_visible": True,
                            "secret_masked": True,
                            "controls_enabled": True,
                        },
                    },
                    {
                        "kind": "text-model-dropdown",
                        "path": "text-model-dropdown.png",
                        "sha256": sha256(OUT / "text-model-dropdown.png"),
                        "ui": {"dropdown_open": True, "item_count": rendered, **text_metrics},
                    },
                    {
                        "kind": "multimodal-model-dropdown",
                        "path": "multimodal-model-dropdown.png",
                        "sha256": sha256(OUT / "multimodal-model-dropdown.png"),
                        "ui": {"dropdown_open": True, "item_count": narrowed, **multimodal_metrics},
                    },
                ],
            }
            for artifact in manifest["artifacts"]:
                if artifact["kind"] != "auth-methods":
                    assert artifact["ui"]["opaque_background"], f"{artifact['kind']} panel is not opaque"
                    assert artifact["ui"]["visible_border"], f"{artifact['kind']} panel has no visible border"
                    assert abs(artifact["ui"]["trigger_panel_right_delta"]) <= 2, f"{artifact['kind']} is misaligned"
            (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
            log(f"wrote manifest.json ({total} chat, {image} image-input models)")
            context.close()
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:  # noqa: BLE001 - teardown must not mask the real failure
                pass
        if server is not None:
            server.send_signal(signal.SIGTERM)
            try:
                server.wait(timeout=15)
            except subprocess.TimeoutExpired:
                server.kill()
        if database is not None:
            database.terminate()
            try:
                database.wait(timeout=15)
            except subprocess.TimeoutExpired:
                database.kill()
        shutil.rmtree(database_root, ignore_errors=True)


if __name__ == "__main__":
    main()
