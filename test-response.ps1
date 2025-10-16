# Test provider Y response
$response = @{
    phone = "+19546144683"
    message = "Y"
} | ConvertTo-Json

Write-Host "Simulating provider Y response..." -ForegroundColor Green
$result = Invoke-RestMethod -Uri "http://localhost:3000/webhooks/test/provider-response" -Method POST -Body $response -ContentType "application/json"
Write-Host "Provider response result:" -ForegroundColor Yellow
$result | ConvertTo-Json -Depth 3
