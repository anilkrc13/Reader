import json
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from src.reader import fonts, server


class FontCatalogTests(unittest.TestCase):
    def test_catalog_identifies_backend_machine_and_normalizes_names(self):
        with patch.object(fonts, 'discover_families', return_value=['Zed', 'Alpha', 'Zed', '', 'Bad\nName']):
            result = fonts.font_catalog()
        self.assertEqual(result['families'], ['Alpha', 'Zed'])
        self.assertEqual(result['provenance'], 'backend-machine')
        self.assertEqual(result['rendering'], 'viewer-verification-required')
        self.assertTrue(result['available'])

    def test_discovery_failure_is_capability_result_not_a_phantom_catalog(self):
        with patch.object(fonts, 'discover_families', side_effect=OSError('private path')):
            result = fonts.font_catalog()
        self.assertFalse(result['available'])
        self.assertEqual(result['families'], [])
        self.assertNotIn('private path', str(result))

    def test_platform_dispatch_and_unsupported_platform(self):
        for platform, adapter in [('darwin', 'mac_families')]:
            with patch.object(fonts.sys, 'platform', platform), patch.object(fonts, adapter, return_value=['Family']):
                self.assertEqual(fonts.discover_families(), ['Family'])
        with patch.object(fonts.sys, 'platform', 'other'):
            self.assertFalse(fonts.font_catalog()['available'])


class FontHttpTests(unittest.TestCase):
    def test_authenticated_endpoint_uses_shared_catalog_and_blocks_unauthorized_requests(self):
        http = server.Server(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        try:
            url = f'http://127.0.0.1:{http.server_address[1]}/api/fonts'
            with self.assertRaises(HTTPError) as failure:
                urlopen(url, timeout=3)
            self.assertEqual(failure.exception.code, 403)
            failure.exception.close()
            expected = {'version': 1, 'available': True, 'families': ['Family']}
            with patch.object(server, 'font_catalog', return_value=expected) as service:
                with urlopen(Request(url, headers={'X-Reader-Token': server.TOKEN}), timeout=3) as response:
                    self.assertEqual(json.load(response), expected)
                service.assert_called_once_with()
            if fonts.sys.platform == 'darwin':
                with urlopen(Request(url, headers={'X-Reader-Token': server.TOKEN}), timeout=15) as response:
                    actual = json.load(response)
                self.assertTrue(actual['available'])
                self.assertGreater(len(actual['families']), 0)
                self.assertEqual(actual['provenance'], 'backend-machine')
        finally:
            http.shutdown()
            http.server_close()
            thread.join(timeout=2)
