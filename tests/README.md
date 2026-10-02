# Test ownership

`server/` checks document operations, authorization, portability, saves, and
repository tools. Run `python3 -m unittest discover -s tests -v`.
`browser/` checks the shared reading UI against an isolated local Reader server.
Run `npm run test:webmcp`. Its shared filesystem fixtures require one worker.

The standalone extension owns `src/reader/chatgpt/tests/`: session and real stdio
protocol tests plus a simulated iframe host browser suite. Run
`npm --prefix src/reader/chatgpt test` after its build, and `npm run test:embedded`
for the bundled UI. Those browser tests use two isolated workers.

`manual/` holds manual diagnostic helpers. Generated screenshots and test output
belong under ignored build/test-result directories. Details are in
[testing](../docs/testing.md); actual host checks are in
[embedded acceptance](../docs/embedded-acceptance.md).
