"""Installed family catalog for the machine running Reader, shared by HTTP and MCP.

No font files, paths, hostname, or font bytes cross the boundary. A family name
is a candidate, not a promise that a remote or privacy-restricted viewer can use it.
"""

import ctypes
import json
import subprocess
import sys
import threading


def mac_families():
    """Use AppKit's catalog in the backend, preserving Reader's native inventory."""
    ctypes.CDLL('/System/Library/Frameworks/AppKit.framework/AppKit')
    objc = ctypes.CDLL('/usr/lib/libobjc.A.dylib')
    objc.objc_getClass.argtypes = [ctypes.c_char_p]
    objc.objc_getClass.restype = ctypes.c_void_p
    objc.sel_registerName.argtypes = [ctypes.c_char_p]
    objc.sel_registerName.restype = ctypes.c_void_p
    objc.objc_msgSend.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    objc.objc_msgSend.restype = ctypes.c_void_p

    def send(receiver, selector):
        return objc.objc_msgSend(receiver, objc.sel_registerName(selector))

    pool = send(send(objc.objc_getClass(b'NSAutoreleasePool'), b'alloc'), b'init')
    cf = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    cf.CFArrayGetCount.argtypes = [ctypes.c_void_p]
    cf.CFArrayGetCount.restype = ctypes.c_long
    cf.CFArrayGetValueAtIndex.argtypes = [ctypes.c_void_p, ctypes.c_long]
    cf.CFArrayGetValueAtIndex.restype = ctypes.c_void_p
    cf.CFStringGetLength.argtypes = [ctypes.c_void_p]
    cf.CFStringGetLength.restype = ctypes.c_long
    cf.CFStringGetMaximumSizeForEncoding.argtypes = [ctypes.c_long, ctypes.c_uint32]
    cf.CFStringGetMaximumSizeForEncoding.restype = ctypes.c_long
    cf.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_long, ctypes.c_uint32]
    cf.CFStringGetCString.restype = ctypes.c_bool
    try:
        manager = send(objc.objc_getClass(b'NSFontManager'), b'sharedFontManager')
        families = send(manager, b'availableFontFamilies')
        if not families:
            raise OSError('font catalog unavailable')
        names = []
        for index in range(cf.CFArrayGetCount(families)):
            string = cf.CFArrayGetValueAtIndex(families, index)
            size = cf.CFStringGetMaximumSizeForEncoding(cf.CFStringGetLength(string), 0x08000100) + 1
            buffer = ctypes.create_string_buffer(size)
            if cf.CFStringGetCString(string, buffer, size, 0x08000100):
                names.append(buffer.value.decode('utf-8'))
        return names
    finally:
        send(pool, b'drain')


def discover_families():
    if sys.platform == 'darwin':
        return mac_families()
    raise OSError('unsupported platform')


def font_catalog():
    result = {
        'version': 1, 'platform': sys.platform, 'provenance': 'backend-machine',
        'rendering': 'viewer-verification-required', 'available': False, 'families': [],
    }
    try:
        # AppKit discovery runs on a process's main thread. HTTP requests are
        # threaded; invoke this same service as a bounded helper in that case.
        if sys.platform == 'darwin' and threading.current_thread() is not threading.main_thread():
            output = subprocess.check_output(
                [sys.executable, __file__], text=True, timeout=15,
                stderr=subprocess.DEVNULL,
            )
            return json.loads(output)
        names = discover_families()
        result['families'] = sorted({
            name for name in names if isinstance(name, str) and name.strip()
            and len(name) <= 256 and not any(ord(c) < 32 or ord(c) == 127 for c in name)
        }, key=str.casefold)
        result['available'] = True
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        result['reason'] = 'Installed font discovery is unavailable on this backend.'
    return result


if __name__ == '__main__':
    print(json.dumps(font_catalog(), ensure_ascii=True))
