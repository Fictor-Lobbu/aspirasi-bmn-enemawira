@echo off
title Sistem ASPIRASI BMN - Lapas Kelas III Enemawira
echo ==================================================================
echo   MEMULAI SISTEM ASPIRASI BMN - LAPAS KELAS III ENEMAWIRA
echo   Membuka akses jaringan lokal (Wi-Fi / Hotspot) di Port 3000...
echo ==================================================================
echo.
REM Membuka port 3000 di Windows Firewall jika dijalankan sebagai Administrator
netsh advfirewall firewall show rule name="ASPIRASI_BMN_3000" >nul 2>&1
if errorlevel 1 (
    netsh advfirewall firewall add rule name="ASPIRASI_BMN_3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
)
start http://localhost:3000
node server.js
pause


