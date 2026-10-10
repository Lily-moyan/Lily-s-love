"""可行性探测：本进程能否读取 Weixin.exe 的内存空间。

用途：在真正扫描密钥之前，先确认（1）能否打开目标进程句柄，（2）能否枚举其可读内存区间。
不读取任何业务内容，只统计区间数量与总字节数。

用法： python probe_mem.py <pid> [<pid> ...]
"""
import ctypes
import sys
from ctypes import wintypes

PROCESS_VM_READ = 0x0010
PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

MEM_COMMIT = 0x1000
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100

# 可读页属性：RW / WRITECOPY / EXECUTE_READ / EXECUTE_READWRITE / EXECUTE_WRITECOPY
READABLE_PROTECT = {0x02, 0x04, 0x20, 0x40, 0x80}

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.VirtualQueryEx.argtypes = [
    wintypes.HANDLE,
    ctypes.c_void_p,
    ctypes.c_void_p,
    ctypes.c_size_t,
]
kernel32.VirtualQueryEx.restype = ctypes.c_size_t


class MEMORY_BASIC_INFORMATION64(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_ulonglong),
        ("AllocationBase", ctypes.c_ulonglong),
        ("AllocationProtect", wintypes.DWORD),
        ("__alignment1", wintypes.DWORD),
        ("RegionSize", ctypes.c_ulonglong),
        ("State", wintypes.DWORD),
        ("Protect", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("__alignment2", wintypes.DWORD),
    ]


def probe(pid: int) -> bool:
    print(f"\n=== PID {pid} ===")
    for label, access in (
        ("VM_READ|QUERY_INFORMATION", PROCESS_VM_READ | PROCESS_QUERY_INFORMATION),
        ("VM_READ|QUERY_LIMITED", PROCESS_VM_READ | PROCESS_QUERY_LIMITED_INFORMATION),
    ):
        h = kernel32.OpenProcess(access, False, pid)
        if not h:
            err = ctypes.get_last_error()
            print(f"  [FAIL] {label:28s} OpenProcess error={err} ({ctypes.FormatError(err)})")
            continue
        print(f"  [ OK ] {label:28s} handle=0x{h:X}")

        mbi = MEMORY_BASIC_INFORMATION64()
        addr = 0
        regions = 0
        total = 0
        readable = 0
        max_addr = 0x7FFFFFFF0000
        while addr < max_addr:
            got = kernel32.VirtualQueryEx(h, ctypes.c_void_p(addr), ctypes.byref(mbi), ctypes.sizeof(mbi))
            if not got:
                break
            base = mbi.BaseAddress
            size = mbi.RegionSize
            if size == 0:
                break
            regions += 1
            total += size
            if (
                mbi.State == MEM_COMMIT
                and not (mbi.Protect & PAGE_GUARD)
                and mbi.Protect != PAGE_NOACCESS
                and (mbi.Protect & 0xFF) in READABLE_PROTECT
            ):
                readable += size
            addr = base + size
        print(f"         区间数={regions}  提交总量={total/1024/1024:.0f} MB  可读={readable/1024/1024:.0f} MB")
        kernel32.CloseHandle(h)
        return True
    return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python probe_mem.py <pid> [<pid> ...]")
        sys.exit(2)
    ok = False
    for arg in sys.argv[1:]:
        try:
            if probe(int(arg)):
                ok = True
        except Exception as exc:  # noqa: BLE001
            print(f"  [ERR ] PID {arg}: {exc!r}")
    print("\n结论:", "至少有一个进程可读，具备扫描条件" if ok else "全部打不开 -> 需要管理员权限")
    sys.exit(0 if ok else 1)
