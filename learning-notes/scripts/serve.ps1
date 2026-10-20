<#
.SYNOPSIS
    本地预览学习笔记站（不需要 Node.js / Python）。

.DESCRIPTION
    在项目根目录启动一个静态文件服务器，默认 http://localhost:8080/。
    直接在浏览器打开 index.html（file:// 协议）时，浏览器会阻止读取本地
    Markdown 文件，所以本地预览请使用本脚本。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/serve.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/serve.ps1 -Port 8081
#>
param(
    [int]$Port = 8080,
    [string]$Root = ''
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot 在参数默认值中求值时可能为空，这里统一兜底
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }

if (-not (Test-Path -LiteralPath $Root)) { throw "根目录不存在：$Root" }
$Root = (Resolve-Path -LiteralPath $Root).Path
$prefix = "http://localhost:$Port/"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
}
catch {
    Write-Host "无法监听 $prefix" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "端口可能被占用，试试：powershell -ExecutionPolicy Bypass -File scripts/serve.ps1 -Port 8081" -ForegroundColor Yellow
    exit 1
}

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.md'   = 'text/markdown; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.webp' = 'image/webp'
    '.ico'  = 'image/x-icon'
}

Write-Host ''
Write-Host "  学习笔记本地预览： $prefix" -ForegroundColor Green
Write-Host "  根目录： $Root" -ForegroundColor DarkGray
Write-Host "  按 Ctrl+C 停止服务。" -ForegroundColor DarkGray
Write-Host ''

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        try {
            $relative = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
            $relative = $relative.TrimStart('/')
            if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
            $relative = $relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar)

            $full = Join-Path $Root $relative
            if (Test-Path -LiteralPath $full -PathType Container) {
                $full = Join-Path $full 'index.html'
            }

            $resolved = [System.IO.Path]::GetFullPath($full)
            if (-not $resolved.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
                $response.StatusCode = 403
                $body = [System.Text.Encoding]::UTF8.GetBytes('403 Forbidden')
            }
            elseif (Test-Path -LiteralPath $resolved -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($resolved).ToLowerInvariant()
                if ($mime.ContainsKey($ext)) { $response.ContentType = $mime[$ext] }
                else { $response.ContentType = 'application/octet-stream' }
                $response.StatusCode = 200
                $body = [System.IO.File]::ReadAllBytes($resolved)
            }
            else {
                $response.StatusCode = 404
                $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $relative")
            }

            $response.Headers['Cache-Control'] = 'no-store'
            $response.ContentLength64 = $body.Length
            $response.OutputStream.Write($body, 0, $body.Length)
        }
        catch {
            try {
                $response.StatusCode = 500
                $bytes = [System.Text.Encoding]::UTF8.GetBytes('500 ' + $_.Exception.Message)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            catch { }
        }
        finally {
            try { $response.OutputStream.Close() } catch { }
        }
    }
}
finally {
    try { $listener.Stop() } catch { }
    try { $listener.Close() } catch { }
    Write-Host ''
    Write-Host '服务已停止。' -ForegroundColor DarkGray
}
