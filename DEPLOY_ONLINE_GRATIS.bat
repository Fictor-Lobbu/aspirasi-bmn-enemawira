@echo off
title Deploy Online Gratis 24 Jam (Vercel) - ASPIRASI BMN
echo ==================================================================
echo   DEPLOY ONLINE GRATIS 24 JAM (TANPA KARTU KREDIT) KE VERCEL.COM
echo   Sistem akan tetap aktif 24 jam meskipun laptop dimatikan!
echo ==================================================================
echo.
echo [Petunjuk Singkat Saat Muncul Pertanyaan di Bawah]:
echo   1. Jika muncul halaman Login di Browser, klik "Continue with GitHub".
echo   2. Set up and deploy?       Tekan ENTER (Y)
echo   3. Which scope?             Tekan ENTER
echo   4. Link to existing project? Tekan ENTER (N)
echo   5. What's your project name? Tekan ENTER (aspirasi-bmn-enemawira)
echo   6. In which directory?       Tekan ENTER (./)
echo.
npx vercel --prod
echo.
pause
