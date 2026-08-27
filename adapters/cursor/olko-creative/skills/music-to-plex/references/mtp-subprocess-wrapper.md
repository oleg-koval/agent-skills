# mtp subprocess wrapper pitfall

Session finding:
- The bot path can accidentally execute the globally installed `mtp` wrapper instead of the checked-out project code.
- That hid a valid NAS connection behind an old launcher that was not exercising the current tree.

Preferred invocation during development:
- Use `uv run python -m mtp.bot.cli handle "<message>" --chat <chat_id>` to exercise the repo checkout.
- In `mtp/bot/mtp_client.py`, subprocesses should call `sys.executable -m mtp ...` so child calls stay on the same environment as the parent process.

Verification:
- Confirm the target NAS endpoint with `curl` or a direct Python request before blaming the network.
- If `mtp-bot` selection still looks wrong, inspect which launcher is being used before assuming the DS API is down.
