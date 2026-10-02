# Test ownership

`server/` checks document operations, authorization, portability, saves, and
repository tools. Run `python3 -m unittest discover -s tests -v`.
`browser/` checks the shared reading UI against an isolated local Reader server.
Run `npm run test:webmcp`. Its shared filesystem fixtures require one worker.

`chatgpt/` owns session and real stdio protocol checks. Its `browser/` folder
contains the simulated iframe host suite. Run `npm run test:chatgpt` after the
adapter build, and `npm run test:embedded`
for the bundled UI. Those browser tests use two isolated workers.

`manual/` holds manual diagnostic helpers. Generated screenshots and test output
belong under ignored build/test-result directories. Details are in
[testing](../docs/testing.md); actual host checks are in
[embedded acceptance](../docs/embedded-acceptance.md).

All test code and test-runner configuration belong under `tests/`. The protocol
client resolves the SDK through the adapter package with Node createRequire. This
uses its pinned dependency without adding another copy to the root test package.
The source-layout check rejects committed tests and generated files under `src`.
Ignored package dependencies are tooling, not application source.
