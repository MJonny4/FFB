# Player identity data

`player-identities-v1.json` is the versioned 1,000-record mock dataset supplied
for Slice 2. The seed reads only `first_name` and `last_name`. Its original
`nationality_code` values are intentionally ignored; the shared deterministic
generator assigns nationalities from the curated European pool.

The source SHA-256 is:

```text
e207a2c790d09af0f2814e543e5839e343d1381e8c7a8071a27f65c7d177055a
```

Changing this file or the generation version is a deliberate data migration,
not a normal seed operation.
