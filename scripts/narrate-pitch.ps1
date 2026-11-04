# Stock system voice for a reviewable local cut. This is not the founder's voice.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$projectDirectory = Split-Path $PSScriptRoot -Parent
$scriptPath = Join-Path $projectDirectory "docs/hackathons/mezo/wave2/NARRATION.txt"
$audioDirectory = Join-Path $projectDirectory "output/video/narration"
New-Item -ItemType Directory -Force -Path $audioDirectory | Out-Null
$paragraphs = (Get-Content -Raw -LiteralPath $scriptPath).Trim() -split '\r?\n\s*\r?\n'
$narrator = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $narrator.SelectVoice("Microsoft David Desktop")
  $narrator.Rate = 1
  for ($index = 0; $index -lt $paragraphs.Length; $index++) {
    $audioPath = Join-Path $audioDirectory ("part-{0:D2}.wav" -f ($index + 1))
    $narrator.SetOutputToWaveFile($audioPath)
    $spokenText = $paragraphs[$index].Replace("MUSD", "M U S D").Replace("x402", "X four oh two").Replace("RPC", "R P C")
    $narrator.Speak($spokenText)
    $narrator.SetOutputToNull()
  }
} finally { $narrator.Dispose() }
Write-Output "Stock-voice narration saved to $audioDirectory"
