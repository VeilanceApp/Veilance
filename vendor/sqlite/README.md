# SQLite WebAssembly vendor files

Veilance includes the official SQLite WebAssembly build from
`sqlite/sqlite-wasm`, version `3.53.0-build1` (SQLite `3.53.0`).

Vendored commit: `41e4f9eaee127835ff2c1aa281d3a8c757359371`

Source: https://github.com/sqlite/sqlite-wasm

The JavaScript bundle contains its upstream SQLite, Emscripten MIT, and
University of Illinois/NCSA license notices. `sqlite3-node.mjs` is included
only so the local automated tests can exercise the same database schema and
queries outside a browser. The extension runtime loads `sqlite3.mjs` and
`sqlite3.wasm` locally; it never loads executable code from a network host.
