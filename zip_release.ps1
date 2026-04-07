# Extract version from manifest.json
$MANIFEST = Get-Content -Raw -Path "manifest.json" | ConvertFrom-Json
$VERSION = $MANIFEST.version

if (-not $VERSION) {
    Write-Host "Error: Could not find version in manifest.json" -ForegroundColor Red
    exit 1
}

$ZIP_NAME = "pixels-dice-roll20-v$VERSION.zip"
Write-Host "Creating release $ZIP_NAME from dist/ folder..."

# Ensure dist exists
if (-not (Test-Path "dist")) {
    Write-Host "Error: dist/ directory not found. Please run 'npm run build' first." -ForegroundColor Red
    exit 1
}

# Remove old zip if it exists
if (Test-Path $ZIP_NAME) {
    Remove-Item $ZIP_NAME
}

# Zip the contents of dist/
# We use -Path "dist/*" to zip the contents without the folder itself
Compress-Archive -Path "dist/*" -DestinationPath $ZIP_NAME -Force

Write-Host "Done! $ZIP_NAME created." -ForegroundColor Green
