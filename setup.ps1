# People Counter — First-time setup
# Run once: .\setup.ps1

$root = $PSScriptRoot

Write-Host "`n=== People Counter Setup ===" -ForegroundColor Cyan

# Check Node
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found. Install from https://nodejs.org" -ForegroundColor Red; exit 1
}
Write-Host "Node.js: $(node --version)" -ForegroundColor Green

# Check Python
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Python not found. Install from https://python.org" -ForegroundColor Red; exit 1
}
Write-Host "Python: $(python --version)" -ForegroundColor Green

# Check Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Docker not found. Install Docker Desktop from https://docker.com" -ForegroundColor Red; exit 1
}
Write-Host "Docker: $(docker --version)" -ForegroundColor Green

# Install Angular CLI globally if needed
if (-not (Get-Command ng -ErrorAction SilentlyContinue)) {
    Write-Host "`nInstalling Angular CLI..." -ForegroundColor Cyan
    npm install -g @angular/cli
}

# Backend deps
Write-Host "`nInstalling backend dependencies..." -ForegroundColor Cyan
Set-Location "$root\backend"
npm install

# Frontend deps
Write-Host "`nInstalling frontend dependencies..." -ForegroundColor Cyan
Set-Location "$root\frontend"
npm install

# Python deps
Write-Host "`nInstalling Python dependencies (this may take a few minutes for YOLOv8)..." -ForegroundColor Cyan
Set-Location "$root\detection"
pip install -r requirements.txt

# Pull Docker images
Write-Host "`nPulling Docker images..." -ForegroundColor Cyan
Set-Location $root
docker compose pull

Write-Host "`n=== Setup complete! Run .\start.ps1 to launch ===" -ForegroundColor Green
