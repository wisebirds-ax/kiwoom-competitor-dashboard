@echo off
chcp 65001 > nul
echo ===================================
echo   경쟁사 광고 데이터 업데이트
echo ===================================
echo.

echo [1단계] 데이터 파일 만드는 중...
node packages/collectors/src/export-json.mjs
if %errorlevel% neq 0 (
    echo.
    echo 오류가 발생했습니다. 수집기를 먼저 실행해주세요.
    pause
    exit /b 1
)

echo.
echo [2단계] GitHub에 올리는 중...
git add packages/dashboard/src/data/
git diff --cached --quiet
if %errorlevel% equ 0 (
    echo 변경된 데이터가 없습니다. 업데이트 불필요.
    pause
    exit /b 0
)
git commit -m "데이터 업데이트"
git push

echo.
echo [3단계] 웹사이트 배포 중...
cd packages\dashboard
vercel --prod
cd ..\..

echo.
echo ===================================
echo   완료!
echo   대시보드가 업데이트됐습니다.
echo ===================================
pause
