"""Back up the database to a timestamped `pg_dump` custom-format file.

    python manage.py backup_db
    python manage.py backup_db --out D:/backups --verify

Writes `<database>-<YYYYmmdd-HHMMSS>.dump` into `--out` (default: the
`BACKUP_DIR` setting, which is outside the repository — a dump holds every
student's record and the GitHub repo is publicly readable). `--verify` then
lists the archive's table of contents with `pg_restore -l` and reports what it
holds, which proves the file is a readable archive rather than a truncated one.

HOW IT REACHES pg_dump
    A local `pg_dump` if one is on PATH; otherwise `docker exec <container>
    pg_dump`, with the container from the `DB_CONTAINER` setting (env
    `DB_CONTAINER`, default `student_ai_db`, as in docker-compose.yml). In the
    container it connects over the local socket, so the host port mapping is
    irrelevant.

CREDENTIALS NEVER APPEAR
    The password is passed in the child's environment as `PGPASSWORD` — never
    on a command line, where any user on the machine could read it from the
    process list. For docker it is forwarded with a bare `-e PGPASSWORD`, which
    docker fills from its own environment. Nothing this command prints contains
    it, and an error from pg_dump is redacted before it is shown.

A FAILED DUMP LEAVES NOTHING BEHIND
    The archive is written to a `.partial` name and renamed only when pg_dump
    succeeds, so a crashed run cannot leave a truncated file that `pilot_check`
    would then count as the latest backup.

RESTORING (not automated, on purpose — a restore replaces data)
    Restore into a *fresh* database first and look at it before touching the
    real one:

        createdb -h 127.0.0.1 -p 5434 -U sai student_ai_restore
        pg_restore -h 127.0.0.1 -p 5434 -U sai --no-owner -d student_ai_restore FILE.dump

    or, with only the container:

        docker exec student_ai_db createdb -U sai student_ai_restore
        docker exec -i student_ai_db pg_restore -U sai --no-owner -d student_ai_restore < FILE.dump

    Replacing the live database is the same with `--clean --if-exists -d
    student_ai`, with the app stopped. Restore as the superuser that owns the
    schema (`sai`): the row-level-security policies and the `student_ai_rls`
    role's grants are in the dump, and a lesser role cannot recreate them.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections
from django.utils import timezone

#: How long a dump or a listing may take before it is called stuck.
TIMEOUT_SECONDS = 60 * 30


def _redact(text: str, secret: str) -> str:
    return text.replace(secret, "***") if secret else text


class Command(BaseCommand):
    help = (
        "Write a timestamped pg_dump (custom format) of the database to BACKUP_DIR "
        "(or --out). --verify lists the archive with pg_restore -l. Uses local "
        "pg_dump if on PATH, else docker exec into DB_CONTAINER. Restore is "
        "documented in this command's module docstring and is deliberately manual: "
        "pg_restore --no-owner -d <a fresh database> FILE.dump, then inspect."
    )

    def add_arguments(self, parser):
        parser.add_argument("--out", default=None, help="Directory for the dump. Default: BACKUP_DIR.")
        parser.add_argument(
            "--verify", action="store_true",
            help="After dumping, list the archive (pg_restore -l) and report its contents.",
        )

    def handle(self, *args, **opts):
        db = connections["default"].settings_dict
        name, password = db.get("NAME") or "", db.get("PASSWORD") or ""
        if not name:
            raise CommandError("The default database has no NAME configured.")

        out_dir = Path(opts["out"] or settings.BACKUP_DIR)
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise CommandError(f"Cannot create {out_dir}: {exc.strerror or exc}.") from None

        stamp = timezone.localtime().strftime("%Y%m%d-%H%M%S")
        final = out_dir / f"{name}-{stamp}.dump"
        partial = final.with_name(final.name + ".partial")

        env = {**os.environ, "PGPASSWORD": password} if password else dict(os.environ)
        local = shutil.which("pg_dump")
        docker = None if local else shutil.which("docker")
        if not local and not docker:
            raise CommandError(
                "Neither pg_dump nor docker is on PATH. Install the PostgreSQL client "
                "tools, or run this where the database container is reachable."
            )

        if local:
            via = "local pg_dump"
            command = [local, "--format=custom", "--no-password", f"--file={partial}",
                       f"--dbname={name}"]
            if db.get("HOST"):
                command.append(f"--host={db['HOST']}")
            if db.get("PORT"):
                command.append(f"--port={db['PORT']}")
            if db.get("USER"):
                command.append(f"--username={db['USER']}")
            stdout_target = subprocess.DEVNULL
        else:
            container = settings.DB_CONTAINER
            via = f"docker exec {container}"
            command = [docker, "exec"]
            if password:
                command += ["-e", "PGPASSWORD"]          # value comes from `env`, not argv
            command += [container, "pg_dump", "--format=custom", "--no-password",
                        f"--dbname={name}"]
            if db.get("USER"):
                command.append(f"--username={db['USER']}")
            stdout_target = None                          # the archive arrives on stdout

        self.stdout.write(f"Backing up '{name}' via {via} …")
        try:
            if stdout_target is None:
                with open(partial, "wb") as fh:
                    result = subprocess.run(command, stdout=fh, stderr=subprocess.PIPE,
                                            env=env, timeout=TIMEOUT_SECONDS, check=False)
            else:
                result = subprocess.run(command, stdout=stdout_target, stderr=subprocess.PIPE,
                                        env=env, timeout=TIMEOUT_SECONDS, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            partial.unlink(missing_ok=True)
            raise CommandError(f"pg_dump could not run: {_redact(str(exc), password)}") from None

        if result.returncode != 0 or not partial.exists() or partial.stat().st_size == 0:
            partial.unlink(missing_ok=True)
            why = _redact((result.stderr or b"").decode("utf-8", "replace").strip(), password)
            raise CommandError(
                f"pg_dump failed (exit {result.returncode}). No backup was written."
                + (f"\n{why}" if why else "")
            )

        os.replace(partial, final)
        size_mb = final.stat().st_size / 1_000_000
        self.stdout.write(self.style.SUCCESS(f"Backup written: {final} ({size_mb:.1f} MB)"))

        if opts["verify"]:
            self._verify(final, env, password)

    def _verify(self, path: Path, env: dict, password: str) -> None:
        """`pg_restore -l` the archive and summarise its table of contents."""
        local = shutil.which("pg_restore")
        try:
            if local:
                result = subprocess.run([local, "--list", str(path)], capture_output=True,
                                        env=env, timeout=TIMEOUT_SECONDS, check=False)
            else:
                docker = shutil.which("docker")
                if not docker:
                    raise CommandError("Cannot verify: neither pg_restore nor docker is on PATH.")
                with open(path, "rb") as fh:
                    result = subprocess.run(
                        [docker, "exec", "-i", settings.DB_CONTAINER, "pg_restore", "--list"],
                        stdin=fh, capture_output=True, env=env, timeout=TIMEOUT_SECONDS,
                        check=False,
                    )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise CommandError(f"pg_restore could not run: {_redact(str(exc), password)}") from None

        if result.returncode != 0:
            why = _redact((result.stderr or b"").decode("utf-8", "replace").strip(), password)
            raise CommandError(
                f"The archive did not verify (pg_restore exit {result.returncode}): {why}"
            )

        listing = (result.stdout or b"").decode("utf-8", "replace").splitlines()
        entries = [line for line in listing if line.strip() and not line.startswith(";")]
        tables = sum(1 for line in entries if " TABLE DATA " in line)
        policies = sum(1 for line in entries if " POLICY " in line)
        self.stdout.write(self.style.SUCCESS(
            f"Verified: {len(entries)} archive entries — {tables} tables with data, "
            f"{policies} row-level-security policies."
        ))
