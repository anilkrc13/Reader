"""Test fixture setup failures must not leave document scratch directories."""

import unittest
from pathlib import Path
from unittest import mock

from . import (
    test_extensionless_files,
    test_move,
    test_portability,
    test_save_security,
    test_workspace_authorization,
)


class FixtureCleanupTests(unittest.TestCase):
    def test_owned_scratch_is_removed_even_when_setup_fails(self):
        fixtures = (
            test_extensionless_files.ExtensionlessFileTests,
            test_move.MoveFileTests,
            test_portability.RecycleBinTrashTests,
            test_save_security.SaveAuthorizationTests,
            test_workspace_authorization.WorkspaceMutationAuthorizationTests,
        )
        for fixture in fixtures:
            with self.subTest(fixture=fixture.__name__):
                case = fixture("runTest")
                case.runTest = lambda: None
                result = unittest.TestResult()
                with mock.patch.object(Path, "mkdir", side_effect=OSError("setup failed")):
                    case.run(result)
                self.assertEqual(len(result.errors), 1)
                self.assertIn("setup failed", result.errors[0][1])
                self.assertFalse(Path(case.tempdir.name).exists())
