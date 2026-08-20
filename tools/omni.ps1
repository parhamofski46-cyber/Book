# omni.ps1 — switch Claude Code between the Anthropic subscription and a local
# OmniRoute gateway with a single command.
#
# Install:  dot-source this file from your PowerShell profile ($PROFILE)
# Usage:    omni on | off | status | stop | restart | help

if (-not $global:OmniPort)  { $global:OmniPort  = 20128 }
if (-not $global:OmniHost)  { $global:OmniHost  = '127.0.0.1' }
# Claude Code sends an Authorization header even when the gateway is keyless.
if (-not $global:OmniToken) { $global:OmniToken = 'omniroute-local' }

function Test-OmniUp {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($global:OmniHost, $global:OmniPort, $null, $null)
        $done  = $async.AsyncWaitHandle.WaitOne(2000, $false)
        return ($done -and $client.Connected)
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Start-OmniGateway {
    if (Test-OmniUp) { return $true }

    if (-not (Get-Command omniroute -ErrorAction SilentlyContinue)) { return $false }

    Write-Host "starting OmniRoute on port $($global:OmniPort) ..." -ForegroundColor Cyan

    # npm lays down three shims side by side: an extensionless bash script, a
    # .cmd and a .ps1. Get-Command can hand back the extensionless one, which
    # Start-Process cannot launch (it fails with 0x87e10bc6), so go through
    # cmd.exe and let it resolve the .cmd from PATH.
    #
    # Runs in its own minimized window rather than a redirected background
    # process: fewer moving parts, and the log stays visible if it misbehaves.
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c omniroute serve' -WindowStyle Minimized

    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        if (Test-OmniUp) { return $true }
    }
    return $false
}

function omni {
    param([string]$Command = 'status')

    switch ($Command) {

        'on' {
            if (-not (Get-Command omniroute -ErrorAction SilentlyContinue)) {
                Write-Host "omniroute is not installed. run:  npm install -g omniroute" -ForegroundColor Red
                return
            }

            if (-not (Start-OmniGateway)) {
                Write-Host "gateway did not come up within 45s." -ForegroundColor Red
                Write-Host "check the minimized cmd window for the reason." -ForegroundColor Yellow
                return
            }

            # Remember what was set before, so 'off' restores it exactly.
            if (-not $global:OmniActive) {
                $global:OmniPrevBaseUrl = $env:ANTHROPIC_BASE_URL
                $global:OmniPrevAuth    = $env:ANTHROPIC_AUTH_TOKEN
            }

            $env:ANTHROPIC_BASE_URL   = "http://$($global:OmniHost):$($global:OmniPort)/v1"
            $env:ANTHROPIC_AUTH_TOKEN = $global:OmniToken
            $global:OmniActive        = $true

            Write-Host "OmniRoute ON  ->  $($env:ANTHROPIC_BASE_URL)" -ForegroundColor Green
            Write-Host "your Claude subscription is NOT in use in this window." -ForegroundColor Yellow
        }

        'off' {
            if (-not $global:OmniActive) {
                Write-Host "already on the Claude subscription. nothing to do." -ForegroundColor Cyan
                return
            }

            if ($global:OmniPrevBaseUrl) {
                $env:ANTHROPIC_BASE_URL = $global:OmniPrevBaseUrl
            } else {
                Remove-Item Env:\ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue
            }

            if ($global:OmniPrevAuth) {
                $env:ANTHROPIC_AUTH_TOKEN = $global:OmniPrevAuth
            } else {
                Remove-Item Env:\ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue
            }

            $global:OmniActive      = $false
            $global:OmniPrevBaseUrl = $null
            $global:OmniPrevAuth    = $null

            Write-Host "OmniRoute OFF  ->  back on the Claude subscription." -ForegroundColor Green
            Write-Host "the gateway is still running. 'omni stop' shuts it down." -ForegroundColor Cyan
        }

        'status' {
            if ($global:OmniActive) {
                Write-Host "mode:     OmniRoute" -ForegroundColor Green
                Write-Host "endpoint: $($env:ANTHROPIC_BASE_URL)"
            } else {
                Write-Host "mode:     Claude subscription" -ForegroundColor Cyan
            }

            if (Test-OmniUp) {
                Write-Host "gateway:  running on port $($global:OmniPort)"
            } else {
                Write-Host "gateway:  stopped"
            }
        }

        'stop' {
            # Same shim problem as the launch path: calling omniroute directly
            # can hit the extensionless npm shim and fail silently, so go
            # through cmd.exe here too.
            Start-Process -FilePath 'cmd.exe' -ArgumentList '/c omniroute stop' -WindowStyle Hidden -Wait

            for ($i = 0; $i -lt 5; $i++) {
                if (-not (Test-OmniUp)) { break }
                Start-Sleep -Seconds 1
            }

            # If it is still listening, close whatever actually holds the port.
            if (Test-OmniUp) {
                $owners = Get-NetTCPConnection -LocalPort $global:OmniPort -State Listen -ErrorAction SilentlyContinue |
                          Select-Object -ExpandProperty OwningProcess -Unique
                foreach ($owner in $owners) {
                    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
                }
                Start-Sleep -Seconds 1
            }

            if (Test-OmniUp) {
                Write-Host "gateway is still answering on port $($global:OmniPort)." -ForegroundColor Red
            } else {
                Write-Host "gateway stopped." -ForegroundColor Green
            }
        }

        'restart' {
            omni stop
            omni on
        }

        default {
            Write-Host @"
omni - switch Claude Code between the subscription and a local OmniRoute gateway

  omni on        start the gateway and route this window through it
  omni off       restore the Claude subscription in this window
  omni status    show the current mode and whether the gateway is up
  omni stop      shut the gateway down
  omni restart   stop, then start and re-attach

Scope: 'on' and 'off' only affect the PowerShell window they run in.
Other windows keep whatever mode they were already in.
"@
        }
    }
}
