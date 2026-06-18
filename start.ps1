# People Counter — Start all services
# Run from the project root: .\start.ps1

$root = $PSScriptRoot

Write-Host "`n[1/4] Starting Docker services (PostgreSQL + Redis)..." -ForegroundColor Cyan
docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker failed. Make sure Docker Desktop is running." -ForegroundColor Red
    exit 1
}

Write-Host "[2/4] Installing Node.js backend dependencies..." -ForegroundColor Cyan
Set-Location "$root\backend"
if (-not (Test-Path "node_modules")) { npm install }

Write-Host "[3/4] Installing Python detection dependencies..." -ForegroundColor Cyan
Set-Location "$root\detection"
pip install -r requirements.txt --quiet

Write-Host "`n[4/4] Starting all services in separate windows..." -ForegroundColor Cyan
Set-Location $root

# Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\backend'; node src/index.js" -WindowStyle Normal

# Detection service
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\detection'; uvicorn main:app --host 0.0.0.0 --port 8000 --reload" -WindowStyle Normal

# Frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\frontend'; npx ng serve --open" -WindowStyle Normal

Write-Host "`n All services launching!" -ForegroundColor Green
Write-Host "  Angular UI  : http://localhost:4200" -ForegroundColor Yellow
Write-Host "  Node API    : http://localhost:3000" -ForegroundColor Yellow
Write-Host "  Detection   : http://localhost:8000" -ForegroundColor Yellow
Write-Host "  Camera feed : http://localhost:8000/stream`n" -ForegroundColor Yellow
