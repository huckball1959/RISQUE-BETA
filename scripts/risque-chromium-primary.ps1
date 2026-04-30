# Snapshots Chromium (Chrome / Edge) top-level windows and moves a handle onto the primary monitor.

if (-not ("ChromiumWindowHelper" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ChromiumWindowHelper {
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rc);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    private const int SW_RESTORE = 9;
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    private static readonly IntPtr HWND_TOP = IntPtr.Zero;
    private const uint SWP_SHOWWINDOW = 0x0040;
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hWnd);

    public static void ActivateWindow(IntPtr h) {
        if (h == IntPtr.Zero) return;
        if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero || fg == h) {
            BringWindowToTop(h);
            SetForegroundWindow(h);
            return;
        }
        uint p1, p2;
        uint fgThread = GetWindowThreadProcessId(fg, out p1);
        uint targetThread = GetWindowThreadProcessId(h, out p2);
        if (fgThread == 0 || targetThread == 0 || fgThread == targetThread) {
            BringWindowToTop(h);
            SetForegroundWindow(h);
            return;
        }
        AttachThreadInput(fgThread, targetThread, true);
        try {
            BringWindowToTop(h);
            SetForegroundWindow(h);
        } finally {
            AttachThreadInput(fgThread, targetThread, false);
        }
    }

    public static List<IntPtr> ListRootChromium() {
        var list = new List<IntPtr>();
        EnumWindows((h, l) => {
            var sb = new StringBuilder(256);
            if (GetClassName(h, sb, 256) == 0) return true;
            if (sb.ToString() != "Chrome_WidgetWin_1") return true;
            if (!IsWindowVisible(h)) return true;
            RECT r;
            if (!GetWindowRect(h, out r)) return true;
            int w = r.Right - r.Left, ht = r.Bottom - r.Top;
            if (w < 320 || ht < 240) return true;
            list.Add(h);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static void MoveToPrimaryWorkArea(IntPtr h, int pl, int pt, int pw, int ph) {
        if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
        if (IsZoomed(h)) ShowWindow(h, SW_RESTORE);
        System.Threading.Thread.Sleep(80);
        RECT r;
        GetWindowRect(h, out r);
        int ww = r.Right - r.Left, hh = r.Bottom - r.Top;
        int maxW = Math.Max(320, pw - 40);
        int maxH = Math.Max(240, ph - 40);
        if (ww > maxW) ww = maxW;
        if (hh > maxH) hh = maxH;
        int x = pl + Math.Max(0, (pw - ww) / 2);
        int y = pt + Math.Max(0, (ph - hh) / 2);
        SetWindowPos(h, HWND_TOP, x, y, ww, hh, SWP_SHOWWINDOW);
        SetForegroundWindow(h);
    }

    /** Move/size a Chromium top-level window to an exact work-area rectangle (any monitor). */
    public static void MoveToRect(IntPtr h, int left, int top, int width, int height) {
        if (h == IntPtr.Zero) return;
        if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
        if (IsZoomed(h)) ShowWindow(h, SW_RESTORE);
        System.Threading.Thread.Sleep(80);
        SetWindowPos(h, HWND_TOP, left, top, width, height, SWP_SHOWWINDOW);
    }
}
"@
}

function Get-RisqueChromiumTopLevelWindows {
    [ChromiumWindowHelper]::ListRootChromium()
}

function Wait-RisqueNewChromiumWindow {
    param(
        [IntPtr[]]$BeforeHandles,
        [int]$TimeoutMs = 4500
    )
    if ($null -eq $BeforeHandles) { $BeforeHandles = [IntPtr[]]@() }
    $seen = New-Object "System.Collections.Generic.HashSet[System.IntPtr]"
    foreach ($x in $BeforeHandles) { [void]$seen.Add($x) }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
        $now = [ChromiumWindowHelper]::ListRootChromium()
        foreach ($h in $now) {
            if (-not $seen.Contains($h)) { return $h }
        }
        Start-Sleep -Milliseconds 100
    }
    return [IntPtr]::Zero
}

function Move-RisqueChromiumToPrimary {
    param([IntPtr]$Handle)
    if ($Handle -eq [IntPtr]::Zero) { return }
    Add-Type -AssemblyName System.Windows.Forms
    $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    [ChromiumWindowHelper]::MoveToPrimaryWorkArea($Handle, $wa.Left, $wa.Top, $wa.Width, $wa.Height)
}

function Move-RisqueChromiumToRect {
    param(
        [IntPtr]$Handle,
        [int]$Left,
        [int]$Top,
        [int]$Width,
        [int]$Height
    )
    if ($Handle -eq [IntPtr]::Zero) { return }
    [ChromiumWindowHelper]::MoveToRect($Handle, $Left, $Top, $Width, $Height)
}
