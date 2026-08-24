# store-listing-copy is marked _source-only

`plugins/olko-release/skills/store-listing-copy/SKILL.md` carries
`metadata.targets: [_source-only]`, which excludes it from the adapter fan-out
while its catalog entry lists seven adapters. One of the two is wrong.

Decide whether the skill should ship to adapters. If yes, remove the marker. If
no, drop the adapters from its catalog entry so the two agree, and teach the
validator that `_source-only` implies an empty adapter list.
