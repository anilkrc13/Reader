import socket
import unittest
from unittest import mock

import reader


class ServerBindSkipsFqdnLookupTests(unittest.TestCase):
    """Pins the fix for the CI startup stall.

    HTTPServer.server_bind() (the base class we would otherwise inherit)
    calls socket.getfqdn(host) while binding, before the socket starts
    listening. On some networks that reverse-DNS lookup stalls for tens of
    seconds, during which the port is bound but not accepting -- which is
    exactly what a client sees as a hung first connection. Reader's Server
    only ever binds to 127.0.0.1, so it has no use for a resolved hostname
    and must not call into the resolver at all.
    """

    def test_construction_does_not_call_getfqdn(self):
        with mock.patch("socket.getfqdn", side_effect=AssertionError(
                "Server.server_bind must not resolve a hostname")):
            server = reader.Server(("127.0.0.1", 0), reader.Handler)
        try:
            self.assertEqual(server.server_name, "127.0.0.1")
            self.assertEqual(server.server_port, server.server_address[1])
        finally:
            server.server_close()

    def test_bind_is_fast_even_if_getfqdn_would_be_slow(self):
        # Belt and suspenders: even if something reintroduces a getfqdn
        # call, binding should never depend on it being fast. This uses a
        # real (patched-slow) resolver rather than a hard failure so the
        # test still demonstrates the timing property, not just the call
        # count.
        import time

        def slow_getfqdn(host=""):
            time.sleep(2)
            return "slow.example.invalid"

        with mock.patch("socket.getfqdn", side_effect=slow_getfqdn):
            start = time.monotonic()
            server = reader.Server(("127.0.0.1", 0), reader.Handler)
            elapsed = time.monotonic() - start
        try:
            self.assertLess(elapsed, 1.0,
                             "Server construction should not wait on DNS")
        finally:
            server.server_close()


if __name__ == "__main__":
    unittest.main()
