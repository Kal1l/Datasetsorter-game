@echo off
echo Creating virtual environment...
py -3 -m venv venv
if errorlevel 1 (
    echo py launcher failed, trying python3...
    python3 -m venv venv
)
if errorlevel 1 (
    echo ERROR: Could not create virtual environment.
    echo Make sure Python 3 is installed and accessible.
    pause
    exit /b 1
)
echo Installing dependencies...
venv\Scripts\pip install -r requirements.txt
echo.
echo Setup complete! Run "run.bat" to start the app.
pause
