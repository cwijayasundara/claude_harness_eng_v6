# Security reference — Python

Language-specific vulnerability patterns to scan for, on top of the generic OWASP categories. Severity guidance: an exploitable instance of any of these is typically critical/high (BLOCK).

- **Unsafe deserialization**: `pickle`/`marshal`/`shelve` on untrusted data; `yaml.load` without `SafeLoader` (use `yaml.safe_load`); `jsonpickle`. BLOCK.
- **Dynamic execution**: `eval`/`exec`/`compile` on any request-influenced string; `__import__`/`importlib` with user input.
- **Command injection**: `subprocess` / `os.system` / `os.popen` with `shell=True` and interpolated input — require arg lists and `shell=False`.
- **SQL injection**: raw `cursor.execute(f"... {x}")`, SQLAlchemy `text()` / `.execute()` with f-strings, `.raw()`/`.extra()` in Django — require bound parameters.
- **Template injection / XSS**: Jinja2 with `autoescape=False`, `| safe`, or `Markup(user_input)`; `render_template_string` on user input.
- **Auth/authz**: routes missing an auth dependency (`Depends(get_current_user)` / decorator); `assert` used for authorization (stripped under `python -O`); JWT decoded without signature/`verify=True`; IDOR (object fetched by id without owner check).
- **SSRF / TLS**: `requests`/`httpx` to a user-supplied URL without allowlist; `verify=False` disabling TLS.
- **Path traversal**: `open`/`os.path.join`/`Path` built from request input without containment (`..`); `send_file` with user path.
- **Secrets/config**: hardcoded `SECRET_KEY`/API keys/passwords; `DEBUG=True` in prod config; secrets logged at INFO+.
- **Crypto**: `hashlib.md5`/`sha1` for passwords (use `bcrypt`/`argon2`); `random` for tokens (use `secrets`).
- **Dependencies**: run `uv pip audit` / `pip-audit` and flag known CVEs in `pyproject.toml`/`requirements.txt`.
