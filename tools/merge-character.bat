@echo off
cd /d "%~dp0.."
set BLENDER=D:/Programs/blender-5.4.0-alpha/blender.exe
if not exist "%BLENDER%" set BLENDER=blender
"%BLENDER%" --background --python tools/blender/merge_mixamo.py -- --src assets_src/mixamo --out assets/player.glb
echo.
echo 完成。检查结果：node tools/glb_info.js assets/player.glb
pause
