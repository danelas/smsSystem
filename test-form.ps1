# Test form submission
$formData = @{
    name = "Test Client"
    phone = "9548724058"
    cityzip = "Hollywood"
    date_time = "16/10/2025"
    length = "60 min"
    type = "Massage"
    location = "Home"
    contactpref = "Text"
    provider_id = "provider10"
} | ConvertTo-Json

Write-Host "Submitting test form..." -ForegroundColor Green
$result = Invoke-RestMethod -Uri "http://localhost:3000/webhooks/fluentforms" -Method POST -Body $formData -ContentType "application/json"
Write-Host "Form submission result:" -ForegroundColor Yellow
$result | ConvertTo-Json -Depth 3
