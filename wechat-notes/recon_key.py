"""
Recon: scan running WeChat (Weixin.exe) process memory for SQLCipher key material.

Read-only. Uses OpenProcess(PROCESS_VM_READ) + VirtualQueryEx + ReadProcessMemory.
Never writes to the target process.
"""
import ctypes
import ctypes.wintypes as wt
import re
import sys
import time

k32 = ctypes.WinDLL("kernel32", use_last_error=True)

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
MEM_COMMIT = 0x1000
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100

READABLE = {0x02, 0x04, 0x08, 0x20, 0x40, 0x80}


class MEMORY_BASIC_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_void_p),
        ("AllocationBase", ctypes.c_void_p),
        ("AllocationProtect", wt.DWORD),
        ("RegionSize", ctypes.c_size_t),
        ("State", wt.DWORD),
        ("Protect", wt.DWORD),
        ("Type", wt.DWORD),
    ]


k32.VirtualQueryEx.argtypes = [wt.HANDLE, ctypes.c_void_p,
                               ctypes.POINTER(MEMORY_BASIC_INFORMATION), ctypes.c_size_t]
k32.VirtualQueryEx.restype = ctypes.c_size_t
k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
k32.OpenProcess.restype = wt.HANDLE
k32.ReadProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p,
                                  ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k32.ReadProcessMemory.restype = wt.BOOL
k32.CloseHandle.argtypes = [wt.HANDLE]


def process_ids():
    """Return [(pid, exe_name)]."""
    TH32CS_SNAPPROCESS = 0x00000002

    class PROCESSENTRY32(ctypes.Structure):
        _fields_ = [
            ("dwSize", wt.DWORD), ("cntUsage", wt.DWORD), ("th32ProcessID", wt.DWORD),
            ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
            ("th32ModuleID", wt.DWORD), ("cntThreads", wt.DWORD),
            ("th32ParentProcessID", wt.DWORD), ("pcPriClassBase", ctypes.c_long),
            ("dwFlags", wt.DWORD), ("szExeFile", ctypes.c_char * 260),
        ]

    snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap == -1:
        return []
    pe = PROCESSENTRY32()
    pe.dwSize = ctypes.sizeof(PROCESSENTRY32)
    out = []
    ok = k32.Process32First(snap, ctypes.byref(pe))
    while ok:
        out.append((pe.th32ProcessID, pe.szExeFile.decode("mbcs", "replace")))
        ok = k32.Process32Next(snap, ctypes.byref(pe))
    k32.CloseHandle(snap)
    return out


# `x'....'` blob literal, hex body length flexible so we can see the real distribution
PAT = re.compile(rb"x'([0-9a-fA-F]{16,512})'")
CHUNK = 4 * 1024 * 1024
OVERLAP = 1100


def scan_process(pid):
    h = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not h:
        return None, f"OpenProcess failed err={ctypes.get_last_error()}", []

    matches = []
    total = 0
    addr = 0
    mbi = MEMORY_BASIC_INFORMATION()
    size_mbi = ctypes.sizeof(mbi)

    while k32.VirtualQueryEx(h, ctypes.c_void_p(addr), ctypes.byref(mbi), size_mbi) == size_mbi:
        base = mbi.BaseAddress or 0
        rsize = mbi.RegionSize
        nxt = base + rsize
        if nxt <= addr:
            break
        addr = nxt
        if mbi.State != MEM_COMMIT:
            continue
        if mbi.Protect & PAGE_GUARD or mbi.Protect & PAGE_NOACCESS:
            continue
        if (mbi.Protect & 0xFF) not in READABLE:
            continue

        off = 0
        prev_tail = b""
        while off < rsize:
            n = min(CHUNK, rsize - off)
            buf = ctypes.create_string_buffer(n)
            read = ctypes.c_size_t(0)
            ok = k32.ReadProcessMemory(h, ctypes.c_void_p(base + off), buf, n, ctypes.byref(read))
            if ok and read.value:
                data = prev_tail + buf.raw[:read.value]
                total += read.value
                for m in PAT.finditer(data):
                    matches.append((base + off - len(prev_tail) + m.start(), m.group(1)))
                prev_tail = data[-OVERLAP:]
            else:
                prev_tail = b""
            off += n
        if len(matches) > 4000:
            break

    k32.CloseHandle(h)
    return total, None, matches


def main():
    procs = [p for p in process_ids() if p[1].lower().startswith("weixin")]
    print(f"Weixin processes: {procs}")
    all_matches = []
    for pid, name in procs:
        t0 = time.time()
        total, err, matches = scan_process(pid)
        if err:
            print(f"  pid={pid} {name}: {err}")
            continue
        print(f"  pid={pid} {name}: scanned {total/1048576:.1f} MB in {time.time()-t0:.1f}s, "
              f"{len(matches)} x'..' literals")
        for a, hexbody in matches:
            all_matches.append((pid, a, hexbody))

    print(f"\nTOTAL literal matches: {len(all_matches)}")
    lens = {}
    for pid, a, h in all_matches:
        lens[len(h)] = lens.get(len(h), 0) + 1
    print("hex-length distribution:", dict(sorted(lens.items())))

    # de-dup identical bodies
    uniq = {}
    for pid, a, h in all_matches:
        uniq.setdefault(h.lower(), []).append((pid, a))
    print(f"unique bodies: {len(uniq)}")
    for h, locs in list(uniq.items())[:60]:
        print(f"  len={len(h)} addr={locs[0][1]:#x} pid={locs[0][0]} body={h[:64]}{'...' if len(h)>64 else ''}")

    with open("key_candidates.txt", "w", encoding="utf-8") as f:
        for h, locs in uniq.items():
            f.write(h + "\n")
    print("\nwrote key_candidates.txt")


if __name__ == "__main__":
    main()
