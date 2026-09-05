# Security

Reader runs a local HTTP server that can read and write files in your home
folder. Its safety rests on a few claims, spelled out in the README under
*Notes on how it works* and in `context/document-integrity.md`:

- the server listens on `127.0.0.1` only and refuses non-loopback `Host` headers;
- every request must carry a session cookie derived from a per-user secret;
- rendered documents are sanitised and served under a Content Security Policy
  that forbids inline and third-party script;
- writes are confined to folders the server process was granted at startup, and
  symlinks cannot extend a grant.

If you find a way to break one of those claims, please report it privately
rather than opening a public issue. Use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository. You should hear back within a week.

Please include the Reader version, how you were running it (app, browser, or
`python3 reader.py`), and a document or request that demonstrates the problem.
