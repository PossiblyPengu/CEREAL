# win32-stream.ps1 — Embed a chiaki-ng window as a child of the Electron window
#
# Usage (called by main.js):
#   win32-stream.ps1 -ChiakiPid <pid> -ParentHwnd <hwnd> -X <x> -Y <y> -W <w> -H <h>
#
# Stdin commands (from main.js):
#   bounds <x> <y> <w> <h>   — reposition chiaki within parent
#   exit                     — clean up and exit
#
# Stdout events (read by main.js):
#   searching pid=<n>        — started polling for chiaki window
#   found hwnd=<n>           — chiaki window located
#   ready                    — embedded and positioned, stream visible
#   error: <msg>             — something went wrong
#   done                     — exiting cleanly

param(
    [Parameter(Mandatory)][int]    $ChiakiPid,
    [Parameter(Mandatory)][string] $ParentHwnd,
    [int] $X = 0,
    [int] $Y = 40,
    [int] $W = 1280,
    [int] $H = 680
)

$ErrorActionPreference = 'Continue'  # don't throw on non-fatal errors

# ── Win32 P/Invoke ─────────────────────────────────────────────────────────────
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class Win32Embed {

    // ── Delegates ───────────────────────────────────────────────────────────
    public delegate bool EnumWindowsDelegate(IntPtr hWnd, IntPtr lParam);

    // ── Imports ─────────────────────────────────────────────────────────────
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsDelegate lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetWindowPos(
        IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy,
        uint uFlags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    // ── Constants ───────────────────────────────────────────────────────────
    public const int GWL_STYLE   = -16;
    public const int GWL_EXSTYLE = -20;

    // Style bits to remove (title bar, resize frame, system menu, min/max buttons)
    public const int WS_BORDER      = 0x00800000;
    public const int WS_DLGFRAME    = 0x00400000;  // WS_BORDER | WS_DLGFRAME = WS_CAPTION
    public const int WS_CAPTION     = 0x00C00000;
    public const int WS_THICKFRAME  = 0x00040000;
    public const int WS_SYSMENU     = 0x00080000;
    public const int WS_MINIMIZEBOX = 0x00020000;
    public const int WS_MAXIMIZEBOX = 0x00010000;

    // Extended style bits to remove
    public const int WS_EX_WINDOWEDGE    = 0x00000100;
    public const int WS_EX_CLIENTEDGE    = 0x00000200;
    public const int WS_EX_DLGMODALFRAME = 0x00000001;
    public const int WS_EX_APPWINDOW     = 0x00040000;
    public const int WS_EX_TOOLWINDOW    = 0x00000080;

    // SetWindowPos flags
    public const uint SWP_NOACTIVATE   = 0x0010;
    public const uint SWP_SHOWWINDOW   = 0x0040;
    public const uint SWP_FRAMECHANGED = 0x0020;
    public const uint SWP_NOZORDER     = 0x0004;

    // Z-order special HWNDs
    public static readonly IntPtr HWND_TOP     = new IntPtr(0);
    public static readonly IntPtr HWND_BOTTOM  = new IntPtr(1);
    public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

    // ShowWindow commands
    public const int SW_HIDE    = 0;
    public const int SW_SHOW    = 5;
    public const int SW_RESTORE = 9;

    // ── Window search by PID ────────────────────────────────────────────────
    private static IntPtr _foundHwnd;
    private static uint   _searchPid;

    private static bool EnumCallback(IntPtr hWnd, IntPtr lParam) {
        uint pid = 0;
        GetWindowThreadProcessId(hWnd, out pid);
        if (pid == _searchPid && IsWindowVisible(hWnd)) {
            _foundHwnd = hWnd;
            return false;  // stop enumeration
        }
        return true;
    }

    public static IntPtr FindWindowByPid(uint pid) {
        _searchPid = pid;
        _foundHwnd = IntPtr.Zero;
        EnumWindows(new EnumWindowsDelegate(EnumCallback), IntPtr.Zero);
        return _foundHwnd;
    }
}
'@ -ErrorAction Stop

# ── Find chiaki window ─────────────────────────────────────────────────────────
Write-Output "searching pid=$ChiakiPid"
[Console]::Out.Flush()

$chiakiHwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 30; $i++) {
    $chiakiHwnd = [Win32Embed]::FindWindowByPid([uint32]$ChiakiPid)
    if ($chiakiHwnd -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 500
}

if ($chiakiHwnd -eq [IntPtr]::Zero) {
    Write-Output "error: window not found for pid $ChiakiPid after 15s"
    [Console]::Out.Flush()
    exit 1
}

Write-Output "found hwnd=$chiakiHwnd"
[Console]::Out.Flush()

# ── Parse parent HWND ─────────────────────────────────────────────────────────
try {
    $parentHwndPtr = [IntPtr][Int64]$ParentHwnd
} catch {
    Write-Output "error: invalid ParentHwnd '$ParentHwnd'"
    [Console]::Out.Flush()
    exit 1
}

# ── Strip title bar and resize frame ──────────────────────────────────────────
$removeMask = [Win32Embed]::WS_CAPTION    `
    -bor [Win32Embed]::WS_THICKFRAME  `
    -bor [Win32Embed]::WS_SYSMENU     `
    -bor [Win32Embed]::WS_MINIMIZEBOX `
    -bor [Win32Embed]::WS_MAXIMIZEBOX

$oldStyle = [Win32Embed]::GetWindowLong($chiakiHwnd, [Win32Embed]::GWL_STYLE)
$newStyle  = $oldStyle -band (-bnot $removeMask)
[Win32Embed]::SetWindowLong($chiakiHwnd, [Win32Embed]::GWL_STYLE, $newStyle) | Out-Null

$removeExMask = [Win32Embed]::WS_EX_WINDOWEDGE `
    -bor [Win32Embed]::WS_EX_CLIENTEDGE    `
    -bor [Win32Embed]::WS_EX_DLGMODALFRAME `
    -bor [Win32Embed]::WS_EX_APPWINDOW

$oldEx = [Win32Embed]::GetWindowLong($chiakiHwnd, [Win32Embed]::GWL_EXSTYLE)
$newEx = ($oldEx -band (-bnot $removeExMask)) -bor [Win32Embed]::WS_EX_TOOLWINDOW
[Win32Embed]::SetWindowLong($chiakiHwnd, [Win32Embed]::GWL_EXSTYLE, $newEx) | Out-Null

# ── Embed as child of Electron window ─────────────────────────────────────────
[Win32Embed]::SetParent($chiakiHwnd, $parentHwndPtr) | Out-Null

# Position: HWND_TOP so chiaki renders above Electron WebContents in that area
[Win32Embed]::SetWindowPos(
    $chiakiHwnd,
    [Win32Embed]::HWND_TOP,
    $X, $Y, $W, $H,
    [Win32Embed]::SWP_SHOWWINDOW -bor [Win32Embed]::SWP_FRAMECHANGED
) | Out-Null

Write-Output "ready"
[Console]::Out.Flush()

# ── Command loop (stdin) ───────────────────────────────────────────────────────
# Commands:  bounds <x> <y> <w> <h>   — reposition
#            exit                     — clean up and quit

$running = $true
while ($running -and [Win32Embed]::IsWindow($chiakiHwnd)) {
    # Non-blocking stdin check
    if ([Console]::In.Peek() -ne -1) {
        $line = $null
        try { $line = [Console]::ReadLine() } catch { break }

        if ($null -eq $line -or $line -eq 'exit') {
            $running = $false
            break
        }

        if ($line -match '^bounds (-?\d+) (-?\d+) (\d+) (\d+)$') {
            $bx = [int]$Matches[1]
            $by = [int]$Matches[2]
            $bw = [int]$Matches[3]
            $bh = [int]$Matches[4]
            [Win32Embed]::SetWindowPos(
                $chiakiHwnd,
                [Win32Embed]::HWND_TOP,
                $bx, $by, $bw, $bh,
                [Win32Embed]::SWP_NOACTIVATE -bor [Win32Embed]::SWP_SHOWWINDOW
            ) | Out-Null
        }

        if ($line -eq 'hide') {
            [Win32Embed]::ShowWindow($chiakiHwnd, [Win32Embed]::SW_HIDE) | Out-Null
        }

        if ($line -eq 'show') {
            [Win32Embed]::ShowWindow($chiakiHwnd, [Win32Embed]::SW_SHOW) | Out-Null
        }

    } else {
        Start-Sleep -Milliseconds 100
    }
}

Write-Output "done"
[Console]::Out.Flush()
