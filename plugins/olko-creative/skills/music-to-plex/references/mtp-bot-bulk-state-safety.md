# mtp-bot bulk import state safety

## Why bulk album requests must be serialized

`mtp-bot` is a chat-scoped state machine. A search that needs a numbered choice leaves the chat in `AWAITING_PICK`; a later request is not an independent request. Concurrent handler calls can therefore collide with or overwrite the intended conversational flow.

## Safe procedure

1. Identify the exact artist and release scope before starting (for example, core studio albums vs. live, compilation, collaboration, or solo records).
2. Check for an existing picker/state in the destination chat before sending any batch item.
3. If a picker exists, preserve it. Only send `cancel` after the user has explicitly authorized cancelling that specific stale request.
4. Send exactly one `mtp-bot handle` request.
5. Read its reply before the next request:
   - **Accepted/downloading:** record it and proceed to the next album only if the handler has returned to idle.
   - **Numbered picker:** stop and ask the requester to choose; never guess a number.
   - **No results / skipped / malformed parse:** stop the batch. Diagnose the request parser or source integration; do not substitute direct `mtp` search/add commands or claim that an import started.
6. Verify the final album only when it is in the library path and visible in Plex/Plexamp.

## Parsing degradation signal

If an otherwise clear message is parsed with artist/album words incorrectly divided, the LLM parser may have fallen back to its simplistic token-splitting heuristic. Treat this as a bot integration issue, not a reason to send malformed variants repeatedly. Preserve the chat state and repair or route the parser before continuing.
